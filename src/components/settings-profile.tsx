import * as React from 'react'
import { Camera, Loader2 } from 'lucide-react'
import { toast } from 'sonner'

import { uploadFile } from '@/lib/api'
import { useCurrentUser } from '@/hooks/use-current-user'
import { api } from '@/trpc/react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export const SettingsProfile = () => {
  const { user, isLoading: isUserLoading, mutate } = useCurrentUser()
  const [name, setName] = React.useState('')
  const [isUploading, setIsUploading] = React.useState(false)
  const [previewUrl, setPreviewUrl] = React.useState<string | null>(null)
  const fileInputRef = React.useRef<HTMLInputElement>(null)

  React.useEffect(() => {
    if (user?.name) {
      setName(user.name)
    }
  }, [user?.name])

  React.useEffect(() => {
    return () => {
      if (previewUrl) {
        URL.revokeObjectURL(previewUrl)
      }
    }
  }, [previewUrl])

  const handleAvatarClick = () => {
    fileInputRef.current?.click()
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
    if (!validTypes.includes(file.type)) {
      toast.error('Please select a valid image file (JPEG, PNG, GIF, or WebP)')
      return
    }

    if (file.size > 5 * 1024 * 1024) {
      toast.error('Image size should be less than 5MB')
      return
    }

    // Create preview
    const objectUrl = URL.createObjectURL(file)
    setPreviewUrl(objectUrl)
    setIsUploading(true)

    try {
      const result = await uploadFile(file, {
        userId: user!.id,
        type: 'avatar',
      })

      if ('error' in result) {
        toast.error(result.error || 'Failed to upload avatar')
        setPreviewUrl(null) // Clear preview on error
        return
      }

      await updateProfileMutation.mutateAsync({ image: result.url })
      // Don't clear previewUrl here to avoid flicker.
      // It will be cleared in mutation onSuccess after revalidation.
    } catch {
      toast.error('An error occurred while uploading avatar')
      setPreviewUrl(null) // Clear preview on error
    } finally {
      setIsUploading(false)
      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
    }
  }

  const updateProfileMutation = api.user.updateProfile.useMutation({
    onSuccess: async () => {
      await mutate()
      setPreviewUrl(null) // Clear preview only after successful revalidation
      toast.success('Profile updated successfully')
    },
    onError: (error) => {
      toast.error(error.message || 'Failed to update profile')
      setPreviewUrl(null)
    },
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    updateProfileMutation.mutate({ name: name.trim() })
  }

  if (isUserLoading) {
    return (
      <div className="flex size-full items-center justify-center">
        <Loader2 className="size-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="space-y-6">
      <form onSubmit={handleSubmit} className="space-y-6">
        <div className="flex items-center justify-between gap-4">
          <label className="text-sm leading-none font-medium">Avatar</label>
          <div className="flex items-center justify-end">
            <div
              className="group relative flex size-10 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-input bg-background shadow-sm transition-colors hover:border-muted-foreground/50"
              onClick={handleAvatarClick}
            >
              <div className="relative size-full overflow-hidden rounded-full">
                {previewUrl || user.image ? (
                  <img
                    className="size-full object-cover"
                    src={previewUrl || user.image || ''}
                    alt={user.name ?? ''}
                    height={56}
                    width={56}
                  />
                ) : (
                  <div className="flex size-full items-center justify-center bg-primary/10 text-sm font-medium text-primary">
                    {user.name
                      ? user.name
                          .split(' ')
                          .map((word) => word[0])
                          .join('')
                          .toUpperCase()
                          .slice(0, 2)
                      : (user.email?.[0] || '?').toUpperCase()}
                  </div>
                )}
              </div>
              <div
                className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 transition-opacity group-hover:opacity-100 data-[uploading=true]:opacity-100"
                data-uploading={isUploading}
              >
                {isUploading ? (
                  <Loader2 className="size-4 animate-spin text-white" />
                ) : (
                  <Camera className="size-4 text-white" />
                )}
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/gif,image/webp"
              className="hidden"
              onChange={handleFileChange}
              disabled={isUploading || updateProfileMutation.isPending}
            />
          </div>
        </div>

        <div className="flex items-center justify-between gap-4">
          <label htmlFor="name" className="text-sm leading-none font-medium">
            Full Name
          </label>
          <div className="flex w-full max-w-64 items-center justify-end gap-2">
            <Input
              id="name"
              type="text"
              placeholder="Enter your name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={updateProfileMutation.isPending || isUploading}
              maxLength={100}
            />
            {(name.trim() !== user.name || updateProfileMutation.isPending) && (
              <Button
                type="submit"
                disabled={
                  updateProfileMutation.isPending ||
                  !name.trim() ||
                  name.trim() === user.name
                }
                className="shrink-0 gap-2"
              >
                {updateProfileMutation.isPending && (
                  <Loader2 className="size-4 animate-spin" />
                )}
                {updateProfileMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            )}
          </div>
        </div>
      </form>
    </div>
  )
}
