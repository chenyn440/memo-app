import { useState, useEffect } from 'react';

interface ToastProps {
  message: string;
  type: 'error' | 'success' | 'info';
  onClose: () => void;
}

function Toast({ message, type, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  const typeClass = `toast toast-${type}`;

  return (
    <div className={typeClass}>
      {message}
      <button onClick={onClose} className="toast-close">
        ×
      </button>
    </div>
  );
}

interface ToastMessage {
  id: number;
  message: string;
  type: 'error' | 'success' | 'info';
}

let toastId = 0;
let addToastCallback: ((toast: ToastMessage) => void) | null = null;

export function showToast(message: string, type: 'error' | 'success' | 'info' = 'info') {
  if (addToastCallback) {
    addToastCallback({ id: toastId++, message, type });
  }
}

export function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  useEffect(() => {
    addToastCallback = (toast) => {
      setToasts((prev) => [...prev, toast]);
    };
    return () => {
      addToastCallback = null;
    };
  }, []);

  const removeToast = (id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  };

  return (
    <>
      {toasts.map((toast) => (
        <Toast
          key={toast.id}
          message={toast.message}
          type={toast.type}
          onClose={() => removeToast(toast.id)}
        />
      ))}
    </>
  );
}
