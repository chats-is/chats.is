import { z } from 'zod';

export type Attachment = {
  /**
   * The name of the attachment, usually the file name.
   */
  name?: string;
  /**
   * A string indicating the [media type](https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Type).
   * By default, it's extracted from the pathname's extension.
   */
  contentType: string;
  /**
   * The URL of the attachment. It can either be a URL to a hosted file or a [Data URL](https://developer.mozilla.org/en-US/docs/Web/HTTP/Basics_of_HTTP/Data_URLs).
   */
  url: string;
};

export const attachmentSchema: z.ZodType<Attachment> = z.object({
  name: z.string().optional(),
  contentType: z.string(),
  url: z.string()
});
