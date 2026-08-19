export interface HealthCheckResponse {
  status: string;
  timestamp: string;
  version: string;
}

export type ConnectionStatus = 'loading' | 'connected' | 'disconnected';
