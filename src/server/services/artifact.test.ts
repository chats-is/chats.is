import { describe, expect, it, vi } from 'vitest';

vi.mock('@/db', () => ({ db: {} }));
vi.mock('@/lib/env', () => ({
  env: { BLOB_READ_WRITE_TOKEN: 'vercel_blob_rw_store123_secret' }
}));

const { buildArtifact, compilePreview } = await import('./artifact');

const owner = { id: 'a1', chatId: 'c1', messageId: 'm1' };

const reactArtifact = (content: string) => ({
  title: 'Counter',
  type: 'code' as const,
  language: 'tsx',
  fileName: 'index.tsx',
  content
});

describe('compilePreview', () => {
  it('compiles each file to CommonJS', () => {
    const result = compilePreview({
      entryPath: '/index.tsx',
      files: [
        {
          path: '/index.tsx',
          code: 'export default function App() { return <div>Hi</div>; }',
          language: 'tsx'
        }
      ]
    });

    expect(result).toMatchObject({ entryPath: '/index.tsx' });
    expect('files' in result && result.files['/index.tsx']).toContain(
      'exports.default = App'
    );
  });

  it('says where a syntax error is, with the line and a caret', () => {
    const result = compilePreview({
      entryPath: '/index.tsx',
      files: [
        {
          path: '/index.tsx',
          code: 'const a = 1;\nconst b = (;\n',
          language: 'tsx'
        }
      ]
    });

    expect('error' in result && result.error).toContain('/index.tsx:2:12:');
    expect('error' in result && result.error).toContain(
      '  const b = (;\n             ^'
    );
  });

  it('says an error once for a source previewed under two paths', () => {
    const code = 'export default function App() { return <div>; }';
    const result = compilePreview({
      entryPath: '/index.tsx',
      files: [
        { path: '/index.tsx', code, language: 'tsx' },
        { path: '/App.tsx', code, language: 'tsx' }
      ]
    });

    expect('error' in result).toBe(true);
    expect('error' in result && result.error).not.toContain('/App.tsx');
  });

  it('refuses a package the frame does not have', () => {
    const result = compilePreview({
      entryPath: '/index.tsx',
      files: [
        {
          path: '/index.tsx',
          code: "import _ from 'lodash';\nexport default () => null;",
          language: 'tsx'
        }
      ]
    });

    expect('error' in result && result.error).toContain('lodash');
  });
});

describe('buildArtifact', () => {
  it('keeps a React artifact that compiles, as the row it becomes', () => {
    const artifact = buildArtifact(
      reactArtifact('export default function App() { return <div>Hi</div>; }'),
      owner
    );

    expect(artifact).toMatchObject({
      id: 'a1',
      chatId: 'c1',
      messageId: 'm1',
      title: 'Counter',
      type: 'code',
      language: 'tsx',
      fileName: 'index.tsx',
      status: 'done'
    });
  });

  it('throws what does not compile, for the model to fix', () => {
    expect(() =>
      buildArtifact(
        reactArtifact('export default function App() { return <div>; }'),
        owner
      )
    ).toThrow(/did not compile, so it was not saved[\s\S]*index\.tsx:1:/);
  });

  it('does not compile what has no preview', () => {
    const artifact = buildArtifact(
      {
        title: 'Script',
        type: 'code',
        language: 'python',
        content: 'def broken(:'
      },
      owner
    );

    expect(artifact.content).toBe('def broken(:');
  });

  it('refuses a file the app did not store', () => {
    expect(() =>
      buildArtifact(
        {
          title: 'Picture',
          type: 'image',
          fileUrl: 'https://example.com/cat.png'
        },
        owner
      )
    ).toThrow('fileUrl must be a file stored by this app');
  });
});
