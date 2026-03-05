interface Connection {
	id: string;
	writer: WritableStreamDefaultWriter;
	lastPing: number;
}

interface Env {
	PAPER_STATUS_DO: DurableObjectNamespace;
}

export class PaperStatusDO {
	private connections: Map<string, Connection> = new Map();
	private heartbeatInterval: number | null = null;

	constructor(
		private state: DurableObjectState,
		private env: Env,
	) {}

	async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);

		if (url.pathname === "/connect" && request.method === "GET") {
			return this.handleConnect(request);
		}

		if (url.pathname === "/notify" && request.method === "POST") {
			return this.handleNotify(request);
		}

		return new Response("Not found", { status: 404 });
	}

	private async handleConnect(request: Request): Promise<Response> {
		const { readable, writable } = new TransformStream();
		const writer = writable.getWriter();
		const encoder = new TextEncoder();

		const connectionId = crypto.randomUUID();

		// Send connection success message
		await writer.write(encoder.encode('data: {"type":"connected"}\n\n'));

		// Save connection
		this.connections.set(connectionId, {
			id: connectionId,
			writer,
			lastPing: Date.now(),
		});

		// Start heartbeat if not already running
		if (!this.heartbeatInterval) {
			this.startHeartbeat();
		}

		return new Response(readable, {
			headers: {
				"Content-Type": "text/event-stream",
				"Cache-Control": "no-cache",
				Connection: "keep-alive",
			},
		});
	}

	private async handleNotify(request: Request): Promise<Response> {
		const data = await request.json();

		// Broadcast to all connections
		await this.broadcast({
			paperId: data.paperId,
			status: data.status,
			progress: data.progress,
			errorMessage: data.errorMessage,
		});

		return new Response("OK");
	}

	private async broadcast(data: unknown): Promise<void> {
		const encoder = new TextEncoder();
		const message = `event: paper-update\ndata: ${JSON.stringify(data)}\n\n`;

		const deadConnections: string[] = [];

		for (const [id, conn] of this.connections) {
			try {
				await conn.writer.write(encoder.encode(message));
			} catch (error) {
				deadConnections.push(id);
			}
		}

		// Clean up dead connections
		for (const id of deadConnections) {
			this.connections.delete(id);
		}
	}

	private startHeartbeat(): void {
		this.heartbeatInterval = setInterval(() => {
			this.sendHeartbeat();
		}, 30000) as unknown as number;
	}

	private async sendHeartbeat(): Promise<void> {
		const encoder = new TextEncoder();
		const ping = encoder.encode(": ping\n\n");

		const deadConnections: string[] = [];

		for (const [id, conn] of this.connections) {
			try {
				await conn.writer.write(ping);
				conn.lastPing = Date.now();
			} catch (error) {
				deadConnections.push(id);
			}
		}

		// Clean up dead connections
		for (const id of deadConnections) {
			this.connections.delete(id);
		}

		// Stop heartbeat if no connections remain
		if (this.connections.size === 0 && this.heartbeatInterval) {
			clearInterval(this.heartbeatInterval);
			this.heartbeatInterval = null;
		}
	}
}
