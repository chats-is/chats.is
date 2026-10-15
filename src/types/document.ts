/** A document's text, as read from its file, and the encoding a text file
 *  was written in — which an artifact reads it in too. None for a PDF, a
 *  Word document or a workbook. */
export type DocumentText = { text: string; encoding: string | null };
