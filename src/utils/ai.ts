import { ChatOpenAI } from "@langchain/openai";
import { OpenAIEmbeddings } from "@langchain/openai";
import { PromptTemplate } from "@langchain/core/prompts";
import { StringOutputParser } from "@langchain/core/output_parsers";
import { Note } from "../types";

export interface AIConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
  embeddingModel: string;
}

export interface RAGCitation {
  index: number;
  noteId: number;
  noteTitle: string;
  snippet: string;
  score: number;
}

export interface RAGAnswerResult {
  answer: string;
  citations: RAGCitation[];
}

interface ChunkDoc {
  noteId: number;
  noteTitle: string;
  text: string;
}

const CHUNK_SIZE = 700;
const CHUNK_OVERLAP = 140;
const MAX_CANDIDATES = 8;

let chunkCacheKey = "";
let cachedChunks: ChunkDoc[] = [];
let cachedEmbeddings: number[][] = [];

const SUMMARY_PROMPT = `
你是一个专业的笔记助手。请为以下笔记内容提供一个简洁、清晰的总结（不超过3句话）。
请使用与原笔记相同的语言。

笔记内容：
{content}

总结：
`;

const POLISH_PROMPT = `
你是一个专业的笔记润色助手。请将以下识别出的语音内容转换为书面笔记。
要求：
1. 修正明显的错别字和语法错误。
2. 去除“嗯”、“啊”、“那个”等口癖和无意义的重复。
3. 保持原意不变，但语气更专业、连贯。
4. 仅返回润色后的文本。

语音内容：
{content}

润色后的内容：
`;

const TRANSLATE_PROMPT = `
你是一个专业的翻译助手。请将以下笔记内容翻译成 {targetLanguage}。
请注意保持 Markdown 格式，并确保翻译准确、自然。

笔记内容：
{content}

翻译后的内容：
`;

const RAG_PROMPT = `
你是一个严谨的笔记问答助手。请只基于“上下文片段”回答用户问题，不要编造。
如果上下文不足，明确说“在当前笔记中没有找到足够依据”。
回答要求：
1. 先直接回答结论。
2. 如有依据，在关键句后标注引用编号，如 [1] [2]。
3. 使用与用户问题一致的语言。

用户问题：
{question}

上下文片段：
{context}

回答：
`;

function isTauriRuntime(): boolean {
  if (typeof window === "undefined") return false;
  return Boolean((window as any).__TAURI_INTERNALS__ || (window as any).__TAURI__);
}

function normalizeBaseUrl(baseUrl: string): string {
  return String(baseUrl || "").trim().replace(/\/+$/, "");
}

async function proxyChatCompletion(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  messages: Array<{ role: "system" | "user" | "assistant"; content: string }>;
  temperature?: number;
}): Promise<string> {
  const response = await fetch("/v1/ai/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: params.apiKey,
      base_url: normalizeBaseUrl(params.baseUrl),
      model: params.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.2,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `AI 代理请求失败(${response.status})`);
  }
  const data = await response.json() as any;
  const raw = data?.choices?.[0]?.message?.content;
  if (typeof raw === "string") return raw.trim();
  if (Array.isArray(raw)) {
    const merged = raw.map((item: any) => (typeof item?.text === "string" ? item.text : "")).join("");
    return merged.trim();
  }
  throw new Error("AI 返回内容为空");
}

async function proxyEmbeddings(params: {
  apiKey: string;
  baseUrl: string;
  model: string;
  input: string | string[];
}): Promise<number[][]> {
  const response = await fetch("/v1/ai/embeddings", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      api_key: params.apiKey,
      base_url: normalizeBaseUrl(params.baseUrl),
      model: params.model,
      input: params.input,
    }),
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(text || `Embedding 代理请求失败(${response.status})`);
  }
  const data = await response.json() as any;
  const vectors = Array.isArray(data?.data) ? data.data.map((item: any) => item?.embedding || []) : [];
  if (!vectors.length) {
    throw new Error("Embedding 返回为空");
  }
  return vectors as number[][];
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function splitIntoChunks(note: Note): ChunkDoc[] {
  const base = `${note.title}\n\n${note.content || ""}`.trim();
  const text = normalize(base);
  if (!text) return [];
  if (text.length <= CHUNK_SIZE) {
    return [{ noteId: note.id, noteTitle: note.title, text }];
  }

  const chunks: ChunkDoc[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(text.length, start + CHUNK_SIZE);
    const segment = text.slice(start, end).trim();
    if (segment) {
      chunks.push({ noteId: note.id, noteTitle: note.title, text: segment });
    }
    if (end >= text.length) break;
    start = Math.max(0, end - CHUNK_OVERLAP);
  }
  return chunks;
}

function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    const av = a[i] ?? 0;
    const bv = b[i] ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  if (!normA || !normB) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function lexicalScore(query: string, text: string): number {
  const q = query.toLowerCase().trim();
  const t = text.toLowerCase();
  if (!q) return 0;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (!tokens.length) return 0;
  let hit = 0;
  for (const token of tokens) {
    if (t.includes(token)) hit += 1;
  }
  return hit / tokens.length;
}

function toCacheKey(notes: Note[], embeddingModel: string): string {
  const brief = notes
    .map((n) => `${n.id}:${n.updated_at}`)
    .sort()
    .join("|");
  return `${embeddingModel}::${brief}`;
}

export const aiService = {
  summarize: async (content: string, config: AIConfig): Promise<string> => {
    console.log("AI Summarize Request - BaseURL:", config.baseUrl, "Model:", config.model);
    
    if (!config.apiKey || config.apiKey.trim() === "") {
      throw new Error("API Key 缺失或为空，请在设置中检查并重新输入");
    }

    try {
      if (!isTauriRuntime()) {
        const result = await proxyChatCompletion({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
          temperature: 0.3,
          messages: [{ role: "user", content: SUMMARY_PROMPT.replace("{content}", content) }],
        });
        return result.trim();
      }
      const llm = new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: {
          baseURL: config.baseUrl,
        },
        modelName: config.model,
        temperature: 0.3,
      });

      const prompt = PromptTemplate.fromTemplate(SUMMARY_PROMPT);
      const chain = prompt.pipe(llm).pipe(new StringOutputParser());

      const result = await chain.invoke({
        content: content,
      });

      return result.trim();
    } catch (error: any) {
      console.error("AI Summarize Error:", error);
      throw new Error(error.message || "AI 总结失败");
    }
  },

  polishSpeech: async (content: string, config: AIConfig): Promise<string> => {
    if (!config.apiKey || !content.trim()) return content;
    
    try {
      if (!isTauriRuntime()) {
        const result = await proxyChatCompletion({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
          temperature: 0.1,
          messages: [{ role: "user", content: POLISH_PROMPT.replace("{content}", content) }],
        });
        return result.trim();
      }
      const llm = new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: {
          baseURL: config.baseUrl,
        },
        modelName: config.model,
        temperature: 0.1,
      });

      const prompt = PromptTemplate.fromTemplate(POLISH_PROMPT);
      const chain = prompt.pipe(llm).pipe(new StringOutputParser());

      const result = await chain.invoke({
        content: content,
      });

      return result.trim();
    } catch (error) {
      console.error("AI Polish Error:", error);
      return content;
    }
  },

  translateNote: async (content: string, targetLanguage: string, config: AIConfig): Promise<string> => {
    if (!config.apiKey || !content.trim()) {
      throw new Error("API Key 缺失或为空，或笔记内容为空");
    }
    if (!targetLanguage.trim()) {
      throw new Error("请指定目标翻译语言");
    }

    try {
      if (!isTauriRuntime()) {
        const promptText = TRANSLATE_PROMPT
          .replace("{targetLanguage}", targetLanguage)
          .replace("{content}", content);
        const result = await proxyChatCompletion({
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
          temperature: 0.1,
          messages: [{ role: "user", content: promptText }],
        });
        return result.trim();
      }
      const llm = new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: {
          baseURL: config.baseUrl,
        },
        modelName: config.model,
        temperature: 0.1,
      });

      const prompt = PromptTemplate.fromTemplate(TRANSLATE_PROMPT);
      const chain = prompt.pipe(llm).pipe(new StringOutputParser());

      const result = await chain.invoke({
        content: content,
        targetLanguage: targetLanguage,
      });

      return result.trim();
    } catch (error: any) {
      console.error("AI Translate Error:", error);
      throw new Error(error.message || "AI 翻译失败");
    }
  },

  answerWithRAG: async (
    question: string,
    notes: Note[],
    keywordMatchedNoteIds: number[],
    config: AIConfig
  ): Promise<RAGAnswerResult> => {
    if (!config.apiKey || config.apiKey.trim() === "") {
      throw new Error("API Key 缺失或为空，请在设置中检查并重新输入");
    }
    const query = question.trim();
    if (!query) {
      throw new Error("问题不能为空");
    }

    const availableNotes = notes.filter((n) => (n.title || "").trim() || (n.content || "").trim());
    if (availableNotes.length === 0) {
      throw new Error("当前没有可检索的笔记内容");
    }

    const embeddingModel = config.embeddingModel?.trim() || "";
    let embeddingAvailable = embeddingModel.length > 0;
    const nextCacheKey = toCacheKey(availableNotes, embeddingModel);
    if (chunkCacheKey !== nextCacheKey) {
      cachedChunks = availableNotes.flatMap(splitIntoChunks);
      if (!cachedChunks.length) {
        throw new Error("无法从笔记中提取有效片段");
      }
      if (embeddingAvailable) {
        try {
          if (isTauriRuntime()) {
            const embeddingClient = new OpenAIEmbeddings({
              apiKey: config.apiKey,
              model: embeddingModel,
              configuration: {
                baseURL: config.baseUrl,
              },
            });
            cachedEmbeddings = await embeddingClient.embedDocuments(cachedChunks.map((c) => c.text));
          } else {
            cachedEmbeddings = await proxyEmbeddings({
              apiKey: config.apiKey,
              baseUrl: config.baseUrl,
              model: embeddingModel,
              input: cachedChunks.map((c) => c.text),
            });
          }
        } catch (error) {
          console.warn("Embedding unavailable, fallback to lexical retrieval:", error);
          embeddingAvailable = false;
          cachedEmbeddings = [];
        }
      } else {
        cachedEmbeddings = [];
      }
      chunkCacheKey = nextCacheKey;
    }

    let queryEmbedding: number[] = [];
    if (embeddingAvailable && cachedEmbeddings.length > 0) {
      try {
        if (isTauriRuntime()) {
          const embeddingClient = new OpenAIEmbeddings({
            apiKey: config.apiKey,
            model: embeddingModel,
            configuration: {
              baseURL: config.baseUrl,
            },
          });
          queryEmbedding = await embeddingClient.embedQuery(query);
        } else {
          const vectors = await proxyEmbeddings({
            apiKey: config.apiKey,
            baseUrl: config.baseUrl,
            model: embeddingModel,
            input: query,
          });
          queryEmbedding = vectors[0] || [];
        }
      } catch (error) {
        console.warn("Embedding query failed, fallback to lexical retrieval:", error);
        embeddingAvailable = false;
      }
    } else {
      embeddingAvailable = false;
    }
    const keywordIdSet = new Set(keywordMatchedNoteIds);

    const ranked = cachedChunks
      .map((chunk, idx) => {
        const semantic = embeddingAvailable
          ? cosineSimilarity(queryEmbedding, cachedEmbeddings[idx] || [])
          : lexicalScore(query, chunk.text);
        const semanticWeight = embeddingAvailable ? 0.75 : 0.45;
        const keywordBoost = keywordIdSet.has(chunk.noteId) ? 0.25 : 0;
        const score = semantic * semanticWeight + keywordBoost;
        return { chunk, score };
      })
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_CANDIDATES);

    const citations: RAGCitation[] = ranked.slice(0, 5).map((item, i) => ({
      index: i + 1,
      noteId: item.chunk.noteId,
      noteTitle: item.chunk.noteTitle,
      snippet: item.chunk.text.slice(0, 260),
      score: Number(item.score.toFixed(4)),
    }));

    const context = citations
      .map((c) => `[${c.index}] ${c.noteTitle}\n${c.snippet}`)
      .join("\n\n");

    let answer = "";
    if (isTauriRuntime()) {
      const llm = new ChatOpenAI({
        apiKey: config.apiKey,
        configuration: {
          baseURL: config.baseUrl,
        },
        modelName: config.model,
        temperature: 0.2,
      });

      const prompt = PromptTemplate.fromTemplate(RAG_PROMPT);
      const chain = prompt.pipe(llm).pipe(new StringOutputParser());
      answer = await chain.invoke({ question: query, context });
    } else {
      const promptText = RAG_PROMPT
        .replace("{question}", query)
        .replace("{context}", context);
      answer = await proxyChatCompletion({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        model: config.model,
        temperature: 0.2,
        messages: [{ role: "user", content: promptText }],
      });
    }

    return {
      answer: answer.trim(),
      citations,
    };
  },
};
