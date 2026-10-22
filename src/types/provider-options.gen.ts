// Written by scripts/gen-provider-options.ts from the installed AI SDK
// packages — not edited by hand. Run `pnpm gen:provider-options` after
// upgrading them.

import { z } from 'zod';

const SCHEMAS = {
  OpenAILanguageModelResponsesOptions: z.strictObject({
    conversation: z.string().nullable().optional(),
    include: z.array(z.enum(["reasoning.encrypted_content", "file_search_call.results", "web_search_call.results", "message.output_text.logprobs"])).nullable().optional(),
    includeWebSearchSources: z.boolean().optional(),
    instructions: z.string().nullable().optional(),
    logprobs: z.union([z.number(), z.boolean()]).optional(),
    maxToolCalls: z.number().nullable().optional(),
    metadata: z.unknown().optional(),
    parallelToolCalls: z.boolean().nullable().optional(),
    previousResponseId: z.string().nullable().optional(),
    promptCacheKey: z.string().nullable().optional(),
    promptCacheOptions: z.strictObject({
      mode: z.enum(["implicit", "explicit"]).optional(),
      ttl: z.literal("30m").optional()
    }).optional(),
    promptCacheRetention: z.enum(["in_memory", "24h"]).nullable().optional(),
    reasoningEffort: z.string().nullable().optional(),
    reasoningEffortUpdate: z.enum(["none", "low", "medium", "high", "xhigh", "max"]).optional(),
    reasoningMode: z.enum(["standard", "pro"]).optional(),
    reasoningContext: z.enum(["auto", "current_turn", "all_turns"]).optional(),
    reasoningSummary: z.string().nullable().optional(),
    safetyIdentifier: z.string().nullable().optional(),
    serviceTier: z.enum(["auto", "default", "flex", "priority", "fast", "ultrafast"]).nullable().optional(),
    store: z.boolean().nullable().optional(),
    passThroughUnsupportedFiles: z.boolean().optional(),
    strictJsonSchema: z.boolean().nullable().optional(),
    textVerbosity: z.enum(["low", "medium", "high"]).nullable().optional(),
    truncation: z.enum(["auto", "disabled"]).nullable().optional(),
    user: z.string().nullable().optional(),
    systemMessageMode: z.enum(["developer", "system", "remove"]).optional(),
    forceReasoning: z.boolean().optional(),
    contextManagement: z.array(z.strictObject({
      type: z.literal("compaction"),
      compactThreshold: z.number()
    })).nullable().optional(),
    compactionTrigger: z.boolean().optional(),
    allowedTools: z.strictObject({
      toolNames: z.array(z.string()),
      mode: z.enum(["auto", "required"]).optional()
    }).optional()
  }),
  OpenAIImageModelGenerationOptions: z.strictObject({
    quality: z.enum(["low", "medium", "high", "xhigh", "max", "standard", "auto", "hd"]).optional(),
    background: z.enum(["auto", "transparent", "opaque"]).optional(),
    outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
    outputCompression: z.number().optional(),
    user: z.string().optional(),
    style: z.enum(["vivid", "natural"]).optional(),
    moderation: z.enum(["low", "auto"]).optional()
  }),
  OpenAIImageModelEditOptions: z.strictObject({
    quality: z.enum(["low", "medium", "high", "xhigh", "max", "standard", "auto", "hd"]).optional(),
    background: z.enum(["auto", "transparent", "opaque"]).optional(),
    outputFormat: z.enum(["png", "jpeg", "webp"]).optional(),
    outputCompression: z.number().optional(),
    user: z.string().optional(),
    inputFidelity: z.enum(["low", "high"]).optional()
  }),
  OpenAISpeechModelOptions: z.strictObject({
    instructions: z.string().nullable().optional(),
    speed: z.number().nullable().optional()
  }),
  OpenAITranscriptionModelOptions: z.strictObject({
    include: z.array(z.string()).optional(),
    language: z.string().optional(),
    prompt: z.string().optional(),
    temperature: z.number().optional(),
    timestampGranularities: z.array(z.enum(["word", "segment"])).optional(),
    responseFormat: z.enum(["json", "verbose_json", "diarized_json"]).optional(),
    chunkingStrategy: z.union([z.literal("auto"), z.strictObject({
      type: z.literal("server_vad"),
      threshold: z.number().optional(),
      prefixPaddingMs: z.number().optional(),
      silenceDurationMs: z.number().optional()
    })]).optional(),
    streaming: z.strictObject({
      delay: z.enum(["low", "medium", "high", "xhigh", "minimal"]).optional(),
      include: z.array(z.string()).optional()
    }).optional()
  }),
  AzureImageModelOptions: z.strictObject({
    autoAspectRatio: z.boolean().optional(),
    webGrounding: z.boolean().optional(),
    api: z.enum(["openai", "mai"]).optional()
  }),
  AzureSpeechModelOptions: z.strictObject({
    style: z.string().optional(),
    styleDegree: z.number().optional(),
    api: z.enum(["openai", "speech"]).optional()
  }),
  AzureTranscriptionModelOptions: z.strictObject({
    language: z.string().optional(),
    timestamps: z.enum(["none", "word", "segment"]).optional(),
    transcribeStyle: z.enum(["verbatim", "clean"]).optional(),
    locales: z.array(z.string()).optional(),
    diarization: z.strictObject({
      enabled: z.boolean()
    }).optional(),
    phraseList: z.strictObject({
      phrases: z.array(z.string())
    }).optional(),
    api: z.enum(["openai", "mai", "speech"]).optional()
  }),
  GoogleLanguageModelOptions: z.strictObject({
    responseModalities: z.array(z.enum(["TEXT", "IMAGE", "AUDIO"])).optional(),
    thinkingConfig: z.strictObject({
      thinkingBudget: z.number().optional(),
      includeThoughts: z.boolean().optional(),
      thinkingLevel: z.enum(["low", "medium", "high", "minimal"]).optional()
    }).optional(),
    cachedContent: z.string().optional(),
    structuredOutputs: z.boolean().optional(),
    safetySettings: z.array(z.strictObject({
      category: z.enum(["HARM_CATEGORY_UNSPECIFIED", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_DANGEROUS_CONTENT", "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_CIVIC_INTEGRITY"]),
      threshold: z.enum(["HARM_BLOCK_THRESHOLD_UNSPECIFIED", "BLOCK_LOW_AND_ABOVE", "BLOCK_MEDIUM_AND_ABOVE", "BLOCK_ONLY_HIGH", "BLOCK_NONE", "OFF"])
    })).optional(),
    threshold: z.enum(["HARM_BLOCK_THRESHOLD_UNSPECIFIED", "BLOCK_LOW_AND_ABOVE", "BLOCK_MEDIUM_AND_ABOVE", "BLOCK_ONLY_HIGH", "BLOCK_NONE", "OFF"]).optional(),
    audioTimestamp: z.boolean().optional(),
    labels: z.record(z.string(), z.string()).optional(),
    mediaResolution: z.enum(["MEDIA_RESOLUTION_UNSPECIFIED", "MEDIA_RESOLUTION_LOW", "MEDIA_RESOLUTION_MEDIUM", "MEDIA_RESOLUTION_HIGH"]).optional(),
    imageConfig: z.strictObject({
      aspectRatio: z.enum(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:8", "8:1", "1:4", "4:1"]).optional(),
      imageSize: z.enum(["1K", "2K", "4K", "512"]).optional(),
      personGeneration: z.enum(["PERSON_GENERATION_UNSPECIFIED", "ALLOW_ALL", "ALLOW_ADULT", "ALLOW_NONE"]).optional(),
      prominentPeople: z.enum(["PROMINENT_PEOPLE_UNSPECIFIED", "ALLOW_PROMINENT_PEOPLE", "BLOCK_PROMINENT_PEOPLE"]).optional(),
      imageOutputOptions: z.strictObject({
        mimeType: z.enum(["image/jpeg", "image/png"]).optional(),
        compressionQuality: z.number().optional()
      }).optional()
    }).optional(),
    retrievalConfig: z.strictObject({
      latLng: z.strictObject({
        latitude: z.number(),
        longitude: z.number()
      }).optional()
    }).optional(),
    streamFunctionCallArguments: z.boolean().optional(),
    serviceTier: z.enum(["standard", "flex", "priority"]).optional(),
    continuationToken: z.string().optional(),
    sharedRequestType: z.enum(["standard", "flex", "priority"]).optional(),
    requestType: z.literal("shared").optional()
  }),
  GoogleImageModelOptions: z.strictObject({
    thinkingConfig: z.strictObject({
      thinkingBudget: z.number().optional(),
      includeThoughts: z.boolean().optional(),
      thinkingLevel: z.enum(["low", "medium", "high", "minimal"]).optional()
    }).optional(),
    cachedContent: z.string().optional(),
    structuredOutputs: z.boolean().optional(),
    safetySettings: z.array(z.strictObject({
      category: z.enum(["HARM_CATEGORY_UNSPECIFIED", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_DANGEROUS_CONTENT", "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_CIVIC_INTEGRITY"]),
      threshold: z.enum(["HARM_BLOCK_THRESHOLD_UNSPECIFIED", "BLOCK_LOW_AND_ABOVE", "BLOCK_MEDIUM_AND_ABOVE", "BLOCK_ONLY_HIGH", "BLOCK_NONE", "OFF"])
    })).optional(),
    threshold: z.enum(["HARM_BLOCK_THRESHOLD_UNSPECIFIED", "BLOCK_LOW_AND_ABOVE", "BLOCK_MEDIUM_AND_ABOVE", "BLOCK_ONLY_HIGH", "BLOCK_NONE", "OFF"]).optional(),
    audioTimestamp: z.boolean().optional(),
    labels: z.record(z.string(), z.string()).optional(),
    mediaResolution: z.enum(["MEDIA_RESOLUTION_UNSPECIFIED", "MEDIA_RESOLUTION_LOW", "MEDIA_RESOLUTION_MEDIUM", "MEDIA_RESOLUTION_HIGH"]).optional(),
    imageConfig: z.strictObject({
      aspectRatio: z.enum(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:8", "8:1", "1:4", "4:1"]).optional(),
      imageSize: z.enum(["1K", "2K", "4K", "512"]).optional(),
      personGeneration: z.enum(["PERSON_GENERATION_UNSPECIFIED", "ALLOW_ALL", "ALLOW_ADULT", "ALLOW_NONE"]).optional(),
      prominentPeople: z.enum(["PROMINENT_PEOPLE_UNSPECIFIED", "ALLOW_PROMINENT_PEOPLE", "BLOCK_PROMINENT_PEOPLE"]).optional(),
      imageOutputOptions: z.strictObject({
        mimeType: z.enum(["image/jpeg", "image/png"]).optional(),
        compressionQuality: z.number().optional()
      }).optional()
    }).optional(),
    retrievalConfig: z.strictObject({
      latLng: z.strictObject({
        latitude: z.number(),
        longitude: z.number()
      }).optional()
    }).optional(),
    streamFunctionCallArguments: z.boolean().optional(),
    serviceTier: z.enum(["standard", "flex", "priority"]).optional(),
    continuationToken: z.string().optional(),
    sharedRequestType: z.enum(["standard", "flex", "priority"]).optional(),
    requestType: z.literal("shared").optional(),
    googleSearch: z.object({
      searchTypes: z.strictObject({
        webSearch: z.record(z.string(), z.never()).optional(),
        imageSearch: z.record(z.string(), z.never()).optional()
      }).optional(),
      timeRangeFilter: z.strictObject({
        startTime: z.string(),
        endTime: z.string()
      }).optional()
    }).catchall(z.unknown()).optional()
  }),
  GoogleVideoModelOptions: z.object({
    pollIntervalMs: z.number().nullable().optional(),
    pollTimeoutMs: z.number().nullable().optional(),
    personGeneration: z.enum(["dont_allow", "allow_adult", "allow_all"]).nullable().optional(),
    negativePrompt: z.string().nullable().optional(),
    referenceImages: z.array(z.strictObject({
      bytesBase64Encoded: z.string().optional(),
      gcsUri: z.string().optional()
    })).nullable().optional()
  }).catchall(z.unknown()),
  GoogleSpeechModelOptions: z.strictObject({
    speechMetadata: z.strictObject({
      speaker: z.string().optional(),
      style: z.string().optional()
    }).optional(),
    turns: z.array(z.strictObject({
      text: z.string(),
      speechMetadata: z.strictObject({
        speaker: z.string().optional(),
        style: z.string().optional()
      }).optional()
    })).optional(),
    multiSpeakerVoiceConfig: z.strictObject({
      speakerVoiceConfigs: z.array(z.strictObject({
        speaker: z.string(),
        voiceConfig: z.strictObject({
          prebuiltVoiceConfig: z.strictObject({
            voiceName: z.string()
          }),
          voice: z.undefined().optional()
        })
      }))
    }).optional()
  }),
  GoogleTranscriptionModelOptions: z.strictObject({
    languageCodes: z.array(z.string()).optional(),
    customVocabulary: z.array(z.string()).optional(),
    wordTimestamp: z.boolean().optional(),
    diarization: z.boolean().optional(),
    mode: z.enum(["SMART", "VERBATIM"]).optional()
  }),
  GoogleVertexImageModelOptions: z.strictObject({
    thinkingConfig: z.strictObject({
      thinkingBudget: z.number().optional(),
      includeThoughts: z.boolean().optional(),
      thinkingLevel: z.enum(["low", "medium", "high", "minimal"]).optional()
    }).optional(),
    cachedContent: z.string().optional(),
    structuredOutputs: z.boolean().optional(),
    safetySettings: z.array(z.strictObject({
      category: z.enum(["HARM_CATEGORY_UNSPECIFIED", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_DANGEROUS_CONTENT", "HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_CIVIC_INTEGRITY"]),
      threshold: z.enum(["HARM_BLOCK_THRESHOLD_UNSPECIFIED", "BLOCK_LOW_AND_ABOVE", "BLOCK_MEDIUM_AND_ABOVE", "BLOCK_ONLY_HIGH", "BLOCK_NONE", "OFF"])
    })).optional(),
    threshold: z.enum(["HARM_BLOCK_THRESHOLD_UNSPECIFIED", "BLOCK_LOW_AND_ABOVE", "BLOCK_MEDIUM_AND_ABOVE", "BLOCK_ONLY_HIGH", "BLOCK_NONE", "OFF"]).optional(),
    audioTimestamp: z.boolean().optional(),
    labels: z.record(z.string(), z.string()).optional(),
    mediaResolution: z.enum(["MEDIA_RESOLUTION_UNSPECIFIED", "MEDIA_RESOLUTION_LOW", "MEDIA_RESOLUTION_MEDIUM", "MEDIA_RESOLUTION_HIGH"]).optional(),
    imageConfig: z.strictObject({
      aspectRatio: z.enum(["1:1", "2:3", "3:2", "3:4", "4:3", "4:5", "5:4", "9:16", "16:9", "21:9", "1:8", "8:1", "1:4", "4:1"]).optional(),
      imageSize: z.enum(["1K", "2K", "4K", "512"]).optional(),
      personGeneration: z.enum(["PERSON_GENERATION_UNSPECIFIED", "ALLOW_ALL", "ALLOW_ADULT", "ALLOW_NONE"]).optional(),
      prominentPeople: z.enum(["PROMINENT_PEOPLE_UNSPECIFIED", "ALLOW_PROMINENT_PEOPLE", "BLOCK_PROMINENT_PEOPLE"]).optional(),
      imageOutputOptions: z.strictObject({
        mimeType: z.enum(["image/jpeg", "image/png"]).optional(),
        compressionQuality: z.number().optional()
      }).optional()
    }).optional(),
    retrievalConfig: z.strictObject({
      latLng: z.strictObject({
        latitude: z.number(),
        longitude: z.number()
      }).optional()
    }).optional(),
    streamFunctionCallArguments: z.boolean().optional(),
    serviceTier: z.enum(["standard", "flex", "priority"]).optional(),
    continuationToken: z.string().optional(),
    sharedRequestType: z.enum(["standard", "flex", "priority"]).optional(),
    requestType: z.literal("shared").optional()
  }),
  GoogleVertexVideoModelOptions: z.object({
    pollIntervalMs: z.number().nullable().optional(),
    pollTimeoutMs: z.number().nullable().optional(),
    personGeneration: z.enum(["dont_allow", "allow_adult", "allow_all"]).nullable().optional(),
    negativePrompt: z.string().nullable().optional(),
    generateAudio: z.boolean().nullable().optional(),
    gcsOutputDirectory: z.string().nullable().optional(),
    referenceImages: z.array(z.strictObject({
      bytesBase64Encoded: z.string().optional(),
      gcsUri: z.string().optional()
    })).nullable().optional()
  }).catchall(z.unknown()),
  GoogleVertexTranscriptionModelOptions: z.strictObject({
    languageCodes: z.array(z.string()).optional(),
    enableAutomaticPunctuation: z.boolean().optional(),
    enableWordTimeOffsets: z.boolean().optional(),
    region: z.string().optional()
  }),
  AnthropicLanguageModelOptions: z.strictObject({
    sendReasoning: z.boolean().optional(),
    structuredOutputMode: z.enum(["auto", "outputFormat", "jsonTool"]).optional(),
    thinking: z.union([z.strictObject({
      type: z.literal("adaptive"),
      display: z.enum(["omitted", "summarized", "updates"]).optional(),
      blockBinding: z.strictObject({
        prefixMismatchBehavior: z.enum(["error", "drop_block"])
      }).optional()
    }), z.strictObject({
      type: z.literal("enabled"),
      budgetTokens: z.number().optional()
    }), z.strictObject({
      type: z.literal("disabled")
    }), z.strictObject({
      type: z.literal("between_tools")
    }), z.strictObject({
      blockBinding: z.strictObject({
        prefixMismatchBehavior: z.enum(["error", "drop_block"])
      }),
      type: z.undefined().optional()
    })]).optional(),
    disableParallelToolUse: z.boolean().optional(),
    cacheControl: z.strictObject({
      type: z.literal("ephemeral"),
      ttl: z.enum(["5m", "1h"]).optional()
    }).optional(),
    metadata: z.strictObject({
      userId: z.string().optional()
    }).optional(),
    mcpServers: z.array(z.strictObject({
      type: z.literal("url"),
      name: z.string(),
      url: z.string(),
      authorizationToken: z.string().nullable().optional(),
      toolConfiguration: z.strictObject({
        enabled: z.boolean().nullable().optional(),
        allowedTools: z.array(z.string()).nullable().optional()
      }).nullable().optional()
    })).optional(),
    container: z.strictObject({
      id: z.string().optional(),
      skills: z.array(z.union([z.strictObject({
        type: z.literal("anthropic"),
        skillId: z.string(),
        version: z.string().optional()
      }), z.strictObject({
        type: z.literal("custom"),
        providerReference: z.record(z.string(), z.string()),
        version: z.string().optional()
      })])).optional()
    }).optional(),
    toolStreaming: z.boolean().optional(),
    effort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
    taskBudget: z.strictObject({
      type: z.literal("tokens"),
      total: z.number(),
      remaining: z.number().optional()
    }).optional(),
    speed: z.enum(["standard", "fast"]).optional(),
    serviceTier: z.enum(["auto", "standard_only"]).optional(),
    inferenceGeo: z.enum(["us", "global"]).optional(),
    fallbacks: z.union([z.literal("default"), z.array(z.strictObject({
      model: z.string(),
      max_tokens: z.number().optional(),
      thinking: z.record(z.string(), z.unknown()).optional(),
      output_config: z.record(z.string(), z.unknown()).optional(),
      speed: z.enum(["standard", "fast"]).optional()
    }))]).optional(),
    anthropicBeta: z.array(z.string()).optional(),
    safeguards: z.array(z.strictObject({
      type: z.literal("dangerous_tool_use"),
      classifierContext: z.record(z.string(), z.unknown()).optional()
    })).optional(),
    compaction: z.strictObject({
      type: z.literal("summarize"),
      instructions: z.string().optional()
    }).optional(),
    contextManagement: z.strictObject({
      edits: z.array(z.union([z.strictObject({
        type: z.literal("clear_tool_uses_20250919"),
        trigger: z.union([z.strictObject({
          type: z.literal("input_tokens"),
          value: z.number()
        }), z.strictObject({
          type: z.literal("tool_uses"),
          value: z.number()
        })]).optional(),
        keep: z.strictObject({
          type: z.literal("tool_uses"),
          value: z.number()
        }).optional(),
        clearAtLeast: z.strictObject({
          type: z.literal("input_tokens"),
          value: z.number()
        }).optional(),
        clearToolInputs: z.boolean().optional(),
        excludeTools: z.array(z.string()).optional()
      }), z.strictObject({
        type: z.literal("clear_thinking_20251015"),
        keep: z.union([z.literal("all"), z.strictObject({
          type: z.literal("thinking_turns"),
          value: z.number()
        })]).optional()
      }), z.strictObject({
        type: z.literal("compact_20260112"),
        trigger: z.strictObject({
          type: z.literal("input_tokens"),
          value: z.number()
        }).optional(),
        pauseAfterCompaction: z.boolean().optional(),
        instructions: z.string().optional()
      })]))
    }).optional()
  }),
  AmazonBedrockLanguageModelChatOptions: z.strictObject({
    structuredOutputMode: z.enum(["auto", "outputFormat", "jsonTool"]).optional(),
    additionalModelRequestFields: z.record(z.string(), z.unknown()).optional(),
    reasoningConfig: z.strictObject({
      type: z.enum(["disabled", "adaptive", "enabled"]).optional(),
      budgetTokens: z.number().optional(),
      maxReasoningEffort: z.enum(["low", "medium", "high", "xhigh", "max"]).optional(),
      display: z.enum(["omitted", "summarized"]).optional()
    }).optional(),
    anthropicBeta: z.array(z.string()).optional(),
    serviceTier: z.enum(["default", "flex", "priority", "reserved"]).optional(),
    requestMetadata: z.record(z.string(), z.string()).optional()
  }),
  AmazonBedrockImageModelOptions: z.strictObject({
    quality: z.enum(["standard", "premium"]).optional(),
    negativeText: z.string().optional(),
    cfgScale: z.number().optional(),
    style: z.enum(["3D_ANIMATED_FAMILY_FILM", "DESIGN_SKETCH", "FLAT_VECTOR_ILLUSTRATION", "GRAPHIC_NOVEL_ILLUSTRATION", "MAXIMALISM", "MIDCENTURY_RETRO", "PHOTOREALISM", "SOFT_DIGITAL_PAINTING"]).optional(),
    taskType: z.enum(["TEXT_IMAGE", "IMAGE_VARIATION", "INPAINTING", "OUTPAINTING", "BACKGROUND_REMOVAL"]).optional(),
    maskPrompt: z.string().optional(),
    outPaintingMode: z.enum(["DEFAULT", "PRECISE"]).optional(),
    similarityStrength: z.number().optional()
  }),
  XaiLanguageModelResponsesOptions: z.strictObject({
    reasoningEffort: z.enum(["none", "low", "medium", "high", "xhigh"]).optional(),
    reasoningSummary: z.enum(["auto", "concise", "detailed"]).optional(),
    logprobs: z.boolean().optional(),
    topLogprobs: z.number().optional(),
    minP: z.number().optional(),
    maxTurns: z.number().optional(),
    parallelToolCalls: z.boolean().optional(),
    promptCacheKey: z.string().optional(),
    safetyIdentifier: z.string().optional(),
    serviceTier: z.enum(["default", "priority"]).optional(),
    store: z.boolean().optional(),
    previousResponseId: z.string().optional(),
    user: z.string().optional(),
    include: z.array(z.enum(["reasoning.encrypted_content", "file_search_call.results", "web_search_call.action.sources", "code_interpreter_call.outputs", "no_inline_citations"])).nullable().optional()
  }),
  XaiImageModelOptions: z.strictObject({
    aspect_ratio: z.string().optional(),
    output_format: z.string().optional(),
    sync_mode: z.boolean().optional(),
    resolution: z.enum(["1k", "1.5k", "2k"]).optional(),
    quality: z.enum(["low", "medium", "high", "auto"]).optional(),
    user: z.string().optional()
  }),
  XaiVideoModelOptions: z.union([z.strictObject({
    mode: z.undefined().optional(),
    videoUrl: z.undefined().optional(),
    referenceImageUrls: z.undefined().optional(),
    keyframes: z.array(z.strictObject({
      imageUrl: z.string(),
      timestampSeconds: z.number()
    })).optional(),
    pollIntervalMs: z.number().nullable().optional(),
    pollTimeoutMs: z.number().nullable().optional(),
    resolution: z.enum(["480p", "720p", "1080p"]).nullable().optional(),
    storageOptions: z.strictObject({
      filename: z.string(),
      expiresAfter: z.number().optional(),
      publicUrl: z.union([z.strictObject({
        expiresAfter: z.number().optional()
      }), z.boolean()]).optional()
    }).optional(),
    user: z.string().optional()
  }), z.strictObject({
    mode: z.literal("edit-video"),
    videoUrl: z.string(),
    pollIntervalMs: z.number().nullable().optional(),
    pollTimeoutMs: z.number().nullable().optional(),
    resolution: z.enum(["480p", "720p", "1080p"]).nullable().optional(),
    storageOptions: z.strictObject({
      filename: z.string(),
      expiresAfter: z.number().optional(),
      publicUrl: z.union([z.strictObject({
        expiresAfter: z.number().optional()
      }), z.boolean()]).optional()
    }).optional(),
    user: z.string().optional()
  }), z.strictObject({
    mode: z.literal("extend-video"),
    videoUrl: z.string(),
    pollIntervalMs: z.number().nullable().optional(),
    pollTimeoutMs: z.number().nullable().optional(),
    resolution: z.enum(["480p", "720p", "1080p"]).nullable().optional(),
    storageOptions: z.strictObject({
      filename: z.string(),
      expiresAfter: z.number().optional(),
      publicUrl: z.union([z.strictObject({
        expiresAfter: z.number().optional()
      }), z.boolean()]).optional()
    }).optional()
  }), z.strictObject({
    mode: z.literal("reference-to-video"),
    referenceImageUrls: z.array(z.string()),
    referenceVoiceIds: z.array(z.string()).optional(),
    pollIntervalMs: z.number().nullable().optional(),
    pollTimeoutMs: z.number().nullable().optional(),
    resolution: z.enum(["480p", "720p", "1080p"]).nullable().optional(),
    storageOptions: z.strictObject({
      filename: z.string(),
      expiresAfter: z.number().optional(),
      publicUrl: z.union([z.strictObject({
        expiresAfter: z.number().optional()
      }), z.boolean()]).optional()
    }).optional(),
    user: z.string().optional()
  }), z.strictObject({
    mode: z.undefined().optional(),
    videoUrl: z.string(),
    pollIntervalMs: z.number().nullable().optional(),
    pollTimeoutMs: z.number().nullable().optional(),
    resolution: z.enum(["480p", "720p", "1080p"]).nullable().optional(),
    storageOptions: z.strictObject({
      filename: z.string(),
      expiresAfter: z.number().optional(),
      publicUrl: z.union([z.strictObject({
        expiresAfter: z.number().optional()
      }), z.boolean()]).optional()
    }).optional(),
    user: z.string().optional()
  }), z.strictObject({
    mode: z.undefined().optional(),
    referenceImageUrls: z.array(z.string()),
    referenceVoiceIds: z.array(z.string()).optional(),
    pollIntervalMs: z.number().nullable().optional(),
    pollTimeoutMs: z.number().nullable().optional(),
    resolution: z.enum(["480p", "720p", "1080p"]).nullable().optional(),
    storageOptions: z.strictObject({
      filename: z.string(),
      expiresAfter: z.number().optional(),
      publicUrl: z.union([z.strictObject({
        expiresAfter: z.number().optional()
      }), z.boolean()]).optional()
    }).optional(),
    user: z.string().optional()
  })]),
  XaiSpeechModelOptions: z.strictObject({
    sampleRate: z.union([z.literal(8000), z.literal(16000), z.literal(22050), z.literal(24000), z.literal(44100), z.literal(48000)]).nullable().optional(),
    bitRate: z.union([z.literal(32000), z.literal(64000), z.literal(96000), z.literal(128000), z.literal(192000)]).nullable().optional(),
    optimizeStreamingLatency: z.union([z.literal(0), z.literal(2), z.literal(1)]).nullable().optional(),
    textNormalization: z.boolean().nullable().optional(),
    withTimestamps: z.boolean().nullable().optional(),
    replace: z.record(z.string(), z.string()).nullable().optional()
  }),
  XaiTranscriptionModelOptions: z.strictObject({
    audioFormat: z.enum(["pcm", "mulaw", "alaw", "opus"]).nullable().optional(),
    sampleRate: z.union([z.literal(8000), z.literal(16000), z.literal(22050), z.literal(24000), z.literal(44100), z.literal(48000)]).nullable().optional(),
    language: z.string().nullable().optional(),
    format: z.boolean().nullable().optional(),
    multichannel: z.boolean().nullable().optional(),
    channels: z.number().nullable().optional(),
    diarize: z.boolean().nullable().optional(),
    keyterm: z.union([z.string(), z.array(z.string())]).nullable().optional(),
    fillerWords: z.boolean().nullable().optional(),
    vadThreshold: z.number().optional(),
    streaming: z.strictObject({
      interimResults: z.boolean().optional(),
      endpointing: z.number().optional(),
      smartTurn: z.number().optional(),
      smartTurnTimeout: z.number().optional()
    }).optional()
  }),
  DeepSeekLanguageModelChatOptions: z.strictObject({
    logprobs: z.boolean().optional(),
    topLogprobs: z.number().optional(),
    userId: z.string().optional(),
    thinking: z.strictObject({
      type: z.enum(["disabled", "enabled"]).optional()
    }).optional(),
    reasoningEffort: z.enum(["low", "high", "max"]).optional(),
    strictJsonSchema: z.boolean().optional()
  })
};

/** The AI SDK option schemas a provider of each type is called with. */
export const PROVIDER_OPTION_SCHEMAS = {
  openai: [SCHEMAS.OpenAILanguageModelResponsesOptions, SCHEMAS.OpenAIImageModelGenerationOptions, SCHEMAS.OpenAIImageModelEditOptions, SCHEMAS.OpenAISpeechModelOptions, SCHEMAS.OpenAITranscriptionModelOptions],
  azure: [SCHEMAS.OpenAILanguageModelResponsesOptions, SCHEMAS.AzureImageModelOptions, SCHEMAS.AzureSpeechModelOptions, SCHEMAS.AzureTranscriptionModelOptions],
  google: [SCHEMAS.GoogleLanguageModelOptions, SCHEMAS.GoogleImageModelOptions, SCHEMAS.GoogleVideoModelOptions, SCHEMAS.GoogleSpeechModelOptions, SCHEMAS.GoogleTranscriptionModelOptions],
  vertex: [SCHEMAS.GoogleLanguageModelOptions, SCHEMAS.GoogleVertexImageModelOptions, SCHEMAS.GoogleVertexVideoModelOptions, SCHEMAS.GoogleSpeechModelOptions, SCHEMAS.GoogleVertexTranscriptionModelOptions, SCHEMAS.GoogleTranscriptionModelOptions],
  anthropic: [SCHEMAS.AnthropicLanguageModelOptions],
  bedrock: [SCHEMAS.AmazonBedrockLanguageModelChatOptions, SCHEMAS.AmazonBedrockImageModelOptions],
  xai: [SCHEMAS.XaiLanguageModelResponsesOptions, SCHEMAS.XaiImageModelOptions, SCHEMAS.XaiVideoModelOptions, SCHEMAS.XaiSpeechModelOptions, SCHEMAS.XaiTranscriptionModelOptions],
  deepseek: [SCHEMAS.DeepSeekLanguageModelChatOptions]
};
