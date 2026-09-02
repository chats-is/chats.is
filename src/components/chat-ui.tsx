import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useArtifact } from '@/contexts/artifact-context'
import { usePreferences } from '@/contexts/preferences-context'
import { useSystemSettings } from '@/contexts/system-settings-context'
import { useChat } from '@ai-sdk/react'
import { DefaultChatTransport } from 'ai'
import { toast } from 'sonner'

import { Artifact, Attachment, ChatMessage, CustomUIDataTypes } from '@/types'
import { takePendingPrompt } from '@/lib/pending-prompt'
import {
  generateUUID,
  getMostRecentUserMessage,
  modelMatchesId,
} from '@/lib/utils'
import { useChats } from '@/hooks/use-chats'
import { api } from '@/trpc/react'
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from '@/components/ui/resizable'
import { useSidebar } from '@/components/ui/sidebar'
import { ArtifactsPanel } from '@/components/artifacts-panel'
import { ChatPanel } from '@/components/chat-panel'
import { ModelOptions } from '@/components/model-menu'

interface ChatUIProps {
  id: string
  initialChat?: { title: string; modelId?: string }
  initialMessages?: ChatMessage[]
  initialArtifacts?: Artifact[]
}

export function ChatUI({
  id,
  initialChat,
  initialMessages = [],
  initialArtifacts = [],
}: ChatUIProps) {
  const { refreshChats } = useChats()

  // Get from contexts
  const { chatModels } = useSystemSettings()
  const { preferences, setPreference } = usePreferences()
  const { isMobile, setOpen, setOpenMobile } = useSidebar()

  const initialTitle = initialChat?.title

  const [input, setInput] = useState('')
  const [title, setTitle] = useState(initialTitle)
  const {
    artifacts,
    activeId,
    isPanelOpen,
    openArtifact,
    setPanelOpen,
    handleStreamPart,
    setArtifactsFromServer,
  } = useArtifact()

  // Track the current model (for next submission)
  // Priority: initialChat.modelId (if valid) > preferences
  const [currentModelId, setCurrentModelId] = useState(
    initialChat?.modelId || preferences.chatModelId,
  )

  // Track the display model (for showing in Messages)
  const [displayModelId, setDisplayModelId] = useState(
    initialChat?.modelId || preferences.chatModelId,
  )

  // Track previous model for rollback on error
  const previousModelRef = useRef<string | null>(null)
  const previousPanelOpenRef = useRef(isPanelOpen)
  const streamStatusRef = useRef('ready')

  // Track isReasoning state
  const [isReasoning, setIsReasoning] = useState(preferences.chatReasoning)

  // Find current model in database models (for API request options)
  const currentDbModel = useMemo(
    () => chatModels?.find((m) => m.modelId === currentModelId),
    [chatModels, currentModelId],
  )

  // Find display model in database models (for showing in Messages)
  const displayDbModel = useMemo(
    () => chatModels?.find((m) => m.modelId === displayModelId),
    [chatModels, displayModelId],
  )

  const displayImage = useMemo(
    () => displayDbModel?.image || displayDbModel?.provider?.image || null,
    [displayDbModel],
  )

  const currentImage = useMemo(
    () => currentDbModel?.image || currentDbModel?.provider?.image || null,
    [currentDbModel],
  )

  const supportsReasoning = useMemo(
    () => currentDbModel?.supportsReasoning,
    [currentDbModel],
  )

  const chatRequestBody = useMemo(
    () => ({
      modelId: currentModelId,
      isReasoning: supportsReasoning ? isReasoning : undefined,
      // Media model selections for the chat media tools; the server falls
      // back to the admin-configured defaults when a modelId is empty.
      mediaOptions: {
        image: preferences.imageModelId
          ? {
              modelId: preferences.imageModelId,
              size: preferences.imageSize,
              aspectRatio: preferences.imageAspectRatio,
            }
          : undefined,
        imageEdit: preferences.imageEditModelId
          ? { modelId: preferences.imageEditModelId }
          : undefined,
        video: preferences.videoModelId
          ? {
              modelId: preferences.videoModelId,
              aspectRatio: preferences.videoAspectRatio,
              resolution: preferences.videoResolution,
              duration: preferences.videoDuration,
            }
          : undefined,
        videoImage: preferences.videoImageModelId
          ? { modelId: preferences.videoImageModelId }
          : undefined,
        videoEdit: preferences.videoEditModelId
          ? { modelId: preferences.videoEditModelId }
          : undefined,
        audio: preferences.audioModelId
          ? {
              modelId: preferences.audioModelId,
              voice: preferences.audioVoice,
            }
          : undefined,
        stt: preferences.sttModelId
          ? { modelId: preferences.sttModelId }
          : undefined,
      },
    }),
    [
      currentModelId,
      supportsReasoning,
      isReasoning,
      preferences.imageModelId,
      preferences.imageSize,
      preferences.imageAspectRatio,
      preferences.imageEditModelId,
      preferences.videoModelId,
      preferences.videoAspectRatio,
      preferences.videoResolution,
      preferences.videoDuration,
      preferences.videoImageModelId,
      preferences.videoEditModelId,
      preferences.audioModelId,
      preferences.audioVoice,
      preferences.sttModelId,
    ],
  )
  const chatRequestBodyRef = useRef(chatRequestBody)

  // Keep ref in sync with the latest request body
  useEffect(() => {
    chatRequestBodyRef.current = chatRequestBody
  }, [chatRequestBody])

  const artifactsQuery = api.artifact.list.useQuery(
    { chatId: id },
    {
      initialData: initialArtifacts.map((artifact) => ({
        id: artifact.id,
        chatId: artifact.chatId,
        messageId: artifact.messageId,
        title: artifact.title,
        type: artifact.type,
        language: artifact.language ?? null,
        content: artifact.content ?? null,
        fileUrl: artifact.fileUrl ?? null,
        fileName: artifact.fileName ?? null,
        mimeType: artifact.mimeType ?? null,
        size: artifact.size ?? null,
        createdAt: artifact.createdAt,
        updatedAt: artifact.updatedAt,
      })),
      // We invalidate these explicitly when a turn finishes; don't also refetch
      // on window focus (it churns artifacts/versions and the preview).
      refetchOnWindowFocus: false,
    },
  )

  const utils = api.useUtils()
  const prevStatusRef = useRef<string | null>(null)

  const {
    status,
    messages,
    stop,
    regenerate,
    setMessages,
    sendMessage,
    error,
  } = useChat<ChatMessage>({
    id,
    messages: initialMessages,
    experimental_throttle: 100,
    generateId: generateUUID,
    // Re-attach to an in-progress generation after a page refresh. Server
    // resume is a no-op when REDIS_URL is unset, so this stays safe.
    resume: true,
    transport: new DefaultChatTransport({
      api: '/api/chat',
      prepareSendMessagesRequest({ messages, body }) {
        const userMessage = getMostRecentUserMessage(messages)
        return {
          body: {
            id,
            userMessage,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            ...chatRequestBodyRef.current,
            ...body,
          },
        }
      },
      // Resume hits the same route as a GET; pass the chat id as a query
      // param so the handler knows which stream to re-attach to.
      prepareReconnectToStreamRequest({ id, api }) {
        return { api: `${api}?chatId=${id}` }
      },
    }),
    onData: (dataPart) => {
      // A refused turn arrives as a normal 200 stream, so onError never runs.
      // Undo the optimistic model switch here instead — the request was often
      // refused *because* of the model that was just picked, and leaving the
      // selector on it says the opposite.
      if (dataPart.type === 'data-error') {
        if (previousModelRef.current) {
          setDisplayModelId(previousModelRef.current)
          previousModelRef.current = null
        }
      }

      if (dataPart.type === 'data-chat' && dataPart.data) {
        const chatData = dataPart.data as CustomUIDataTypes['chat']
        if (chatData.title) {
          if (!title) {
            window.history.replaceState({}, '', `/chat/${id}`)
            refreshChats()
          }
          setTitle(chatData.title)
        }
        // Clear previous model ref on success
        previousModelRef.current = null
      }
      handleStreamPart(dataPart, id)
    },
    onError: () => {
      // Not toasted: `error` is rendered in the thread by <Messages>, where it
      // sits next to the message it answers and does not disappear. Showing
      // both would repeat one failure twice.
      // Revert displayModel on error
      if (previousModelRef.current) {
        setDisplayModelId(previousModelRef.current)
        previousModelRef.current = null
      }
      void artifactsQuery.refetch()
    },
  })

  useEffect(() => {
    streamStatusRef.current = status
  }, [status])

  // When a turn finishes, the server has persisted new artifacts; refresh so the
  // chat's artifact list reflects the latest state.
  useEffect(() => {
    const prev = prevStatusRef.current
    prevStatusRef.current = status
    if ((prev === 'streaming' || prev === 'submitted') && status === 'ready') {
      void utils.artifact.list.invalidate({ chatId: id })
    }
  }, [status, id, utils])

  useEffect(() => {
    if (artifactsQuery.data) {
      setArtifactsFromServer(artifactsQuery.data, {
        preserveStreamingForChatId:
          streamStatusRef.current === 'submitted' ||
          streamStatusRef.current === 'streaming'
            ? id
            : null,
      })
    }
  }, [artifactsQuery.data, id, setArtifactsFromServer])

  useEffect(() => {
    setPanelOpen(false)
  }, [id, setPanelOpen])

  // Seed the composer from a prompt picked on the Prompts page. Read after
  // mount (not during render) to avoid a hydration mismatch, and only for a
  // fresh chat so an in-progress conversation is never clobbered.
  useEffect(() => {
    if (initialMessages.length > 0) return
    const pending = takePendingPrompt()
    if (pending) setInput(pending)
    // Mount-only: consume the one-shot hand-off exactly once.
  }, [])

  useEffect(() => {
    if (status === 'ready') {
      artifactsQuery.refetch()
    }
  }, [status, artifactsQuery.refetch])

  useEffect(() => {
    const wasPanelOpen = previousPanelOpenRef.current
    previousPanelOpenRef.current = isPanelOpen

    if (!isPanelOpen || wasPanelOpen) return

    if (isMobile) {
      setOpenMobile(false)
      return
    }

    setOpen(false)
  }, [isMobile, isPanelOpen, setOpen, setOpenMobile])

  const noChat = useMemo(
    () => !title && status === 'ready' && messages.length === 0,
    [title, status, messages.length],
  )

  // Handle model change from ModelMenu
  const handleModelChange = useCallback(
    (newModelId: string) => {
      setCurrentModelId(newModelId)
      setPreference('chatModelId', newModelId)
    },
    [setPreference],
  )

  // Handle options change from ModelMenu (like reasoning toggle)
  const handleOptionsChange = useCallback(
    (options: ModelOptions) => {
      if (options.isReasoning !== undefined) {
        setIsReasoning(options.isReasoning)
        setPreference('chatReasoning', options.isReasoning)
      }
    },
    [setPreference],
  )

  // Helper to update displayModel optimistically
  const updateDisplayModelOptimistically = useCallback(() => {
    if (currentModelId !== displayModelId) {
      previousModelRef.current = displayModelId
      setDisplayModelId(currentModelId)
    }
  }, [currentModelId, displayModelId])

  const handleReload = useCallback(
    (message: ChatMessage) => {
      updateDisplayModelOptimistically()
      const parentMessageId =
        message.role === 'assistant' ? message.metadata?.parentId : message.id

      regenerate({
        messageId: message.id,
        ...(parentMessageId ? { body: { parentMessageId } } : {}),
      })
    },
    [regenerate, updateDisplayModelOptimistically],
  )

  const handleSubmit = useCallback(
    (attachments?: Attachment[]) => {
      if (!input.trim()) return false
      // Last line of defence behind the form's own disabled state: an empty or
      // unresolvable model would only earn a 400 from /api/chat. Alias-aware,
      // because that is how the server resolves it — matching on modelId alone
      // would reject a chat stored under an older id.
      if (!chatModels?.some((model) => modelMatchesId(model, currentModelId))) {
        toast.error('Select a model before sending.')
        return false
      }
      updateDisplayModelOptimistically()
      sendMessage({
        text: input,
        files: attachments?.map((attachment) => ({
          type: 'file',
          mediaType: attachment.contentType,
          filename: attachment.name,
          url: attachment.url,
        })),
      })
      return true
    },
    [
      input,
      chatModels,
      currentModelId,
      sendMessage,
      updateDisplayModelOptimistically,
    ],
  )

  const handleArtifactSelect = useCallback(
    (artifactId: string) => {
      openArtifact(artifactId)
    },
    [openArtifact],
  )

  const artifactList = useMemo<Artifact[]>(() => {
    return Object.values(artifacts)
      .filter((artifact) => artifact.chatId === id && !!artifact.messageId)
      .map((artifact) => {
        return {
          id: artifact.id,
          chatId: artifact.chatId,
          messageId: artifact.messageId!,
          title: artifact.title,
          type: artifact.type,
          language: artifact.language ?? null,
          content: artifact.content,
          fileUrl: artifact.url ?? null,
          fileName: artifact.fileName ?? null,
          mimeType: artifact.mimeType ?? null,
          size: artifact.size ?? null,
          status: artifact.status,
          createdAt: artifact.createdAt ?? new Date(),
          updatedAt: artifact.updatedAt ?? new Date(),
        }
      })
  }, [artifacts, id])

  useEffect(() => {
    if (!isPanelOpen) return

    if (artifactList.length === 0) {
      setPanelOpen(false)
      return
    }

    if (
      activeId &&
      !artifactList.some((artifact) => artifact.id === activeId)
    ) {
      setPanelOpen(false)
    }
  }, [activeId, artifactList, isPanelOpen, setPanelOpen])

  return (
    <div className="flex size-full overflow-hidden">
      {isPanelOpen && !isMobile ? (
        <ResizablePanelGroup
          orientation="horizontal"
          className="h-full w-full flex-1 overflow-hidden"
        >
          <ResizablePanel
            defaultSize="44%"
            minSize="35%"
            className="flex h-full min-w-0 flex-col overflow-hidden"
          >
            <ChatPanel
              title={title}
              noChat={noChat}
              modelId={displayModelId}
              image={displayImage}
              currentModelId={currentModelId}
              currentImage={currentImage}
              supportsReasoning={supportsReasoning}
              artifacts={artifactList}
              messages={messages}
              setMessages={setMessages}
              status={status}
              stop={stop}
              input={input}
              setInput={setInput}
              onInputChange={(e) => setInput(e.target.value)}
              onSubmit={handleSubmit}
              onModelChange={handleModelChange}
              onOptionsChange={handleOptionsChange}
              onSelectArtifact={handleArtifactSelect}
              onReload={handleReload}
              error={error}
            />
          </ResizablePanel>
          <ResizableHandle withHandle />
          <ResizablePanel
            defaultSize="56%"
            minSize="25%"
            maxSize="65%"
            className="h-full min-w-0 overflow-hidden"
          >
            <ArtifactsPanel
              open={isPanelOpen}
              onOpenChange={setPanelOpen}
              artifacts={artifactList}
              selectedId={activeId}
              onSelect={handleArtifactSelect}
              desktopContainerClassName="h-full w-full min-w-0 max-w-none border-l-0"
            />
          </ResizablePanel>
        </ResizablePanelGroup>
      ) : (
        <div className="flex w-full flex-1 overflow-hidden">
          <ChatPanel
            title={title}
            noChat={noChat}
            modelId={displayModelId}
            image={displayImage}
            currentModelId={currentModelId}
            currentImage={currentImage}
            supportsReasoning={supportsReasoning}
            artifacts={artifactList}
            messages={messages}
            setMessages={setMessages}
            status={status}
            stop={stop}
            input={input}
            setInput={setInput}
            onInputChange={(e) => setInput(e.target.value)}
            onSubmit={handleSubmit}
            onModelChange={handleModelChange}
            onOptionsChange={handleOptionsChange}
            onSelectArtifact={handleArtifactSelect}
            onReload={handleReload}
            error={error}
          />
          <ArtifactsPanel
            open={isPanelOpen}
            onOpenChange={setPanelOpen}
            artifacts={artifactList}
            selectedId={activeId}
            onSelect={handleArtifactSelect}
          />
        </div>
      )}
    </div>
  )
}
