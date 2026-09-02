export type ProviderType =
  | 'openai'
  | 'azure'
  | 'google'
  | 'vertex'
  | 'anthropic'
  | 'bedrock'
  | 'xai'
  | 'deepseek';

export type ProviderConfig = {
  type: ProviderType;
  apiKey?: string | null;
  baseUrl?: string | null;
  apiOptions?: Record<string, unknown> | null;
};

export type VertexAuthMode = 'service_account' | 'api_key';

export type VertexServiceAccountKey = {
  location?: string;
  credentials?: {
    project_id?: string;
    private_key_id?: string;
    private_key?: string;
  } & Record<string, unknown>;
};
