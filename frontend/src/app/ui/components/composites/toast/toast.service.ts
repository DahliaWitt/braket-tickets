import { Injectable } from '@angular/core';
import { toast } from 'ngx-sonner';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface ToastOptions {
  message: string;
  type?: ToastType;
  duration?: number;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

@Injectable({
  providedIn: 'root',
})
export class BraToastService {
  show(options: ToastOptions) {
    const { message, type, duration, description, action } = options;
    // ngx-sonner types don't index signature well, so casting strict types
    const toastFn = type
      ? (toast[type] as (message: unknown, options?: unknown) => string | number)
      : (toast as unknown as (message: unknown, options?: unknown) => string | number);

    toastFn(message, {
      duration,
      description,
      action: action
        ? {
            label: action.label,
            onClick: action.onClick,
          }
        : undefined,
    });
  }

  success(message: string, options?: Omit<ToastOptions, 'message' | 'type'>) {
    this.show({ message, type: 'success', ...options });
  }

  error(message: string, options?: Omit<ToastOptions, 'message' | 'type'>) {
    this.show({ message, type: 'error', ...options });
  }
}
