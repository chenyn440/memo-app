import Foundation
import Speech
import AVFoundation

class SpeechHelper {
    let recognizer: SFSpeechRecognizer
    let audioEngine = AVAudioEngine()
    var recognitionRequest: SFSpeechAudioBufferRecognitionRequest?
    var recognitionTask: SFSpeechRecognitionTask?
    var lastResult = ""

    init?() {
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "zh-CN")) else {
            fputs("ERROR: Speech recognizer not available for zh-CN\n", stderr)
            return nil
        }
        self.recognizer = recognizer
    }

    func requestAuthorization(completion: @escaping (Bool) -> Void) {
        AVCaptureDevice.requestAccess(for: .audio) { micGranted in
            if !micGranted {
                fputs("ERROR: Microphone access denied\n", stderr)
                completion(false)
                return
            }

            SFSpeechRecognizer.requestAuthorization { status in
                switch status {
                case .authorized:
                    completion(true)
                default:
                    fputs("ERROR: Speech recognition not authorized, status: \(status.rawValue)\n", stderr)
                    completion(false)
                }
            }
        }
    }

    func startRecognition() {
        lastResult = ""

        recognitionRequest = SFSpeechAudioBufferRecognitionRequest()
        guard let recognitionRequest = recognitionRequest else { return }

        recognitionRequest.shouldReportPartialResults = true
        if #available(macOS 13, *) {
            recognitionRequest.addsPunctuation = true
            if recognizer.supportsOnDeviceRecognition {
                recognitionRequest.requiresOnDeviceRecognition = true
            }
        }

        let inputNode = audioEngine.inputNode
        let recordingFormat = inputNode.outputFormat(forBus: 0)

        inputNode.installTap(onBus: 0, bufferSize: 4096, format: recordingFormat) { buffer, _ in
            recognitionRequest.append(buffer)
        }

        audioEngine.prepare()
        do {
            try audioEngine.start()
        } catch {
            fputs("ERROR: Audio engine failed to start: \(error)\n", stderr)
            return
        }

        recognitionTask = recognizer.recognitionTask(with: recognitionRequest) { [weak self] result, error in
            guard let self = self else { return }

            if let result = result {
                let text = result.bestTranscription.formattedString
                if text != self.lastResult {
                    self.lastResult = text
                    if result.isFinal {
                        print("FINAL:\(text)")
                        fflush(stdout)
                    } else {
                        print("PARTIAL:\(text)")
                        fflush(stdout)
                    }
                }
            }
            if let error = error {
                fputs("ERROR: Recognition error: \(error.localizedDescription)\n", stderr)
            }
        }
    }

    func stop() {
        audioEngine.stop()
        audioEngine.inputNode.removeTap(onBus: 0)
        recognitionRequest?.endAudio()

        if !lastResult.isEmpty {
            print("FINAL:\(lastResult)")
            fflush(stdout)
        }

        recognitionTask?.cancel()
    }
}

// Main
let helper = SpeechHelper()
guard let speech = helper else {
    exit(1)
}

speech.requestAuthorization { authorized in
    guard authorized else {
        print("DONE")
        fflush(stdout)
        exit(1)
    }

    speech.startRecognition()

    DispatchQueue.global().async {
        while let line = readLine() {
            if line.trimmingCharacters(in: .whitespacesAndNewlines) == "STOP" {
                DispatchQueue.main.async {
                    speech.stop()
                    print("DONE")
                    fflush(stdout)
                    exit(0)
                }
                return
            }
        }
        DispatchQueue.main.async {
            speech.stop()
            print("DONE")
            fflush(stdout)
            exit(0)
        }
    }
}

dispatchMain()
