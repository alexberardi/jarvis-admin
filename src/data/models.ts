export interface LlmModel {
  id: string
  displayName: string
  hfRepoVllm: string
  hfRepoGguf: string
  ggufFilename: string
  chatFormat: string
  contextWindow: number
  sizeVllm: string
  sizeGguf: string
  vramMb: number
  gated: boolean
  quantization: string
}

export const LLM_MODELS: LlmModel[] = [
  {
    id: 'qwen3-4b',
    displayName: 'Qwen 3 4B',
    hfRepoVllm: 'Qwen/Qwen3-4B-AWQ',
    hfRepoGguf: 'bartowski/Qwen3-4B-GGUF',
    ggufFilename: 'Qwen3-4B-Q4_K_M.gguf',
    chatFormat: 'qwen3',
    contextWindow: 40960,
    sizeVllm: '2.5GB',
    sizeGguf: '2.5GB',
    vramMb: 4096,
    gated: false,
    quantization: 'awq',
  },
  {
    id: 'llama-3.2-3b',
    displayName: 'Llama 3.2 3B Instruct',
    hfRepoVllm: 'AMead10/Llama-3.2-3B-Instruct-AWQ',
    hfRepoGguf: 'bartowski/Llama-3.2-3B-Instruct-GGUF',
    ggufFilename: 'Llama-3.2-3B-Instruct-Q4_K_M.gguf',
    chatFormat: 'llama3',
    contextWindow: 131072,
    sizeVllm: '2.9GB',
    sizeGguf: '2GB',
    vramMb: 4096,
    gated: true,
    quantization: 'awq',
  },
  {
    id: 'qwen3-8b',
    displayName: 'Qwen 3 8B',
    hfRepoVllm: 'Qwen/Qwen3-8B-AWQ',
    hfRepoGguf: 'bartowski/Qwen3-8B-GGUF',
    ggufFilename: 'Qwen3-8B-Q4_K_M.gguf',
    chatFormat: 'qwen3',
    contextWindow: 40960,
    sizeVllm: '5.7GB',
    sizeGguf: '5GB',
    vramMb: 7168,
    gated: false,
    quantization: 'awq',
  },
  {
    id: 'llama-3.1-8b',
    displayName: 'Llama 3.1 8B Instruct',
    hfRepoVllm: 'hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4',
    hfRepoGguf: 'bartowski/Meta-Llama-3.1-8B-Instruct-GGUF',
    ggufFilename: 'Meta-Llama-3.1-8B-Instruct-Q4_K_M.gguf',
    chatFormat: 'llama3',
    contextWindow: 131072,
    sizeVllm: '5.4GB',
    sizeGguf: '5GB',
    vramMb: 7168,
    gated: true,
    quantization: 'awq',
  },
  {
    id: 'mistral-nemo-12b',
    displayName: 'Mistral Nemo 12B',
    hfRepoVllm: 'casperhansen/mistral-nemo-instruct-2407-awq',
    hfRepoGguf: 'bartowski/Mistral-Nemo-Instruct-2407-GGUF',
    ggufFilename: 'Mistral-Nemo-Instruct-2407-Q4_K_M.gguf',
    chatFormat: 'mistral',
    contextWindow: 131072,
    sizeVllm: '7.8GB',
    sizeGguf: '7GB',
    vramMb: 10240,
    gated: false,
    quantization: 'awq',
  },
  {
    id: 'qwen3-14b',
    displayName: 'Qwen 3 14B',
    hfRepoVllm: 'Qwen/Qwen3-14B-AWQ',
    hfRepoGguf: 'bartowski/Qwen3-14B-GGUF',
    ggufFilename: 'Qwen3-14B-Q4_K_M.gguf',
    chatFormat: 'qwen3',
    contextWindow: 40960,
    sizeVllm: '9.4GB',
    sizeGguf: '9GB',
    vramMb: 12288,
    gated: false,
    quantization: 'awq',
  },
]
