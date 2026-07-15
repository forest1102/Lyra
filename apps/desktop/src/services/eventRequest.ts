export interface IpcResult<T = unknown> {
  requestId: string;
  ok: boolean;
  data?: T;
  error?: string;
}

type UnlistenFn = () => void;
type EmitFn = (event: string, payload: Record<string, unknown>) => Promise<void>;
type ListenFn = (
  event: string,
  listener: (event: { payload: IpcResult }) => void
) => Promise<UnlistenFn>;

interface PendingRequest {
  event: string;
  resolve(value: unknown): void;
  reject(error: Error): void;
  timeout: ReturnType<typeof setTimeout>;
}

export class EventRequestBroker {
  private readonly pending = new Map<string, PendingRequest>();
  private startPromise: Promise<void> | null = null;
  private unlisten: UnlistenFn | null = null;
  private disposed = false;

  constructor(private readonly options: {
    emit: EmitFn;
    listen: ListenFn;
    timeoutMs?: number;
    createRequestId?: () => string;
  }) {}

  async request<T>(event: string, payload: Record<string, unknown>): Promise<T> {
    if (this.disposed) throw new Error("event request broker is disposed");
    await this.start();
    const requestId = (this.options.createRequestId ?? (() => crypto.randomUUID()))();
    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(requestId);
        reject(new Error(`${event} timed out`));
      }, this.options.timeoutMs ?? 10_000);
      this.pending.set(requestId, {
        event,
        resolve: (value) => resolve(value as T),
        reject,
        timeout
      });
      void this.options.emit(event, { requestId, ...payload }).catch((cause: unknown) => {
        const pending = this.pending.get(requestId);
        if (!pending) return;
        clearTimeout(pending.timeout);
        this.pending.delete(requestId);
        pending.reject(cause instanceof Error ? cause : new Error(String(cause)));
      });
    });
  }

  dispose(): void {
    this.disposed = true;
    this.unlisten?.();
    this.unlisten = null;
    for (const request of this.pending.values()) {
      clearTimeout(request.timeout);
      request.reject(new Error(`${request.event} was cancelled`));
    }
    this.pending.clear();
  }

  private start(): Promise<void> {
    this.startPromise ??= this.options.listen("ipc://result", (event) => {
      const pending = this.pending.get(event.payload.requestId);
      if (!pending) return;
      clearTimeout(pending.timeout);
      this.pending.delete(event.payload.requestId);
      if (event.payload.ok) pending.resolve(event.payload.data);
      else pending.reject(new Error(event.payload.error ?? `${pending.event} failed`));
    }).then((unlisten) => {
      if (this.disposed) unlisten();
      else this.unlisten = unlisten;
    });
    return this.startPromise;
  }
}
