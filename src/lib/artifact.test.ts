import { convertToModelMessages } from 'ai';
import { describe, expect, it } from 'vitest';

import { type ChatMessage } from '@/types';

import {
  artifactKindFromType,
  assertArtifactPayload,
  blockedHtmlResources,
  dataPartForModel,
  getArtifactKind,
  isPreviewableCodeArtifact,
  isRelativeImport,
  isStyleImport,
  looksLikeJsx,
  previewPackageImports,
  validatePreviewImports
} from './artifact';
import { PREVIEW_PACKAGES } from './constant';

describe('artifactKindFromType', () => {
  it('maps each artifact type to its UI kind', () => {
    expect(artifactKindFromType('image')).toBe('image');
    expect(artifactKindFromType('file')).toBe('file');
    expect(artifactKindFromType('json')).toBe('sheet');
    expect(artifactKindFromType('code')).toBe('code');
    expect(artifactKindFromType('html')).toBe('code');
    expect(artifactKindFromType('markdown')).toBe('text');
    expect(artifactKindFromType('text')).toBe('text');
  });

  it('falls back to text for unknown/empty type', () => {
    expect(artifactKindFromType(null)).toBe('text');
    expect(artifactKindFromType(undefined)).toBe('text');
  });
});

describe('getArtifactKind', () => {
  it('delegates to the type of the artifact-like object', () => {
    expect(getArtifactKind({ type: 'json' })).toBe('sheet');
    expect(getArtifactKind({ type: 'image' })).toBe('image');
  });
});

describe('looksLikeJsx', () => {
  it('detects JSX elements and fragments', () => {
    expect(looksLikeJsx('return <div>hi</div>;')).toBe(true);
    expect(looksLikeJsx('const a = <Foo />;')).toBe(true);
    expect(looksLikeJsx('return <>x</>;')).toBe(true);
  });

  it('does not flag plain code or comparisons', () => {
    expect(looksLikeJsx('const a = 1 < 2;')).toBe(false);
    expect(looksLikeJsx('export const x = 5;')).toBe(false);
  });
});

describe('isRelativeImport / isStyleImport', () => {
  it('recognises relative specifiers', () => {
    expect(isRelativeImport('./Button')).toBe(true);
    expect(isRelativeImport('../lib/x')).toBe(true);
    expect(isRelativeImport('react')).toBe(false);
  });

  it('recognises style specifiers including query strings', () => {
    expect(isStyleImport('./styles.css')).toBe(true);
    expect(isStyleImport('./a.scss')).toBe(true);
    expect(isStyleImport('./a.sass?inline')).toBe(true);
    expect(isStyleImport('./a.ts')).toBe(false);
  });
});

describe('validatePreviewImports', () => {
  it('returns nothing for allowed/relative/style imports', () => {
    const code = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { Button } from './Button';
      import './styles.css';
    `;
    expect(validatePreviewImports(code)).toEqual([]);
  });

  it('allows every curated package, as the model writes it', () => {
    const code = PREVIEW_PACKAGES.map(
      pkg => `import * as m from '${pkg.name}';`
    ).join('\n');
    expect(validatePreviewImports(code)).toEqual([]);
  });

  it('flags disallowed package imports (deduped)', () => {
    const code = `
      import { format } from 'date-fns';
      import x from 'moment';
      import y from 'moment';
      const z = require('axios');
    `;
    const result = validatePreviewImports(code);
    expect(result).toContain('date-fns');
    expect(result).toContain('moment');
    expect(result).toContain('axios');
    expect(result.filter(s => s === 'moment')).toHaveLength(1);
  });

  it('flags a package path the frame does not load', () => {
    const code = `
      import Chart from 'chart.js';
      import { Calendar } from '@/components/ui/calendar';
    `;
    expect(validatePreviewImports(code)).toEqual([
      'chart.js',
      '@/components/ui/calendar'
    ]);
  });

  it('flags dynamic import() of a disallowed package', () => {
    const code = "const m = await import('got');";
    expect(validatePreviewImports(code)).toEqual(['got']);
  });
});

describe('previewPackageImports', () => {
  it('lists the curated packages the code imports, once each', () => {
    const code = `
      import React from 'react';
      import * as d3 from 'd3';
      import { Button } from '@/components/ui/button';
      import { select } from 'd3';
      import { Helper } from './helper';
    `;
    expect(previewPackageImports(code)).toEqual([
      'd3',
      '@/components/ui/button'
    ]);
  });
});

describe('isPreviewableCodeArtifact', () => {
  it('is true only for code with a previewable language', () => {
    expect(isPreviewableCodeArtifact({ type: 'code', language: 'tsx' })).toBe(
      true
    );
    expect(isPreviewableCodeArtifact({ type: 'code', language: 'React' })).toBe(
      true
    );
    expect(
      isPreviewableCodeArtifact({ type: 'code', language: 'python' })
    ).toBe(false);
    expect(isPreviewableCodeArtifact({ type: 'html', language: 'tsx' })).toBe(
      false
    );
    expect(isPreviewableCodeArtifact({ type: 'code', language: null })).toBe(
      false
    );
  });
});

describe('assertArtifactPayload', () => {
  it('requires fileUrl for file/image artifacts', () => {
    expect(() => assertArtifactPayload({ type: 'image' })).toThrow(/fileUrl/);
    expect(() =>
      assertArtifactPayload({ type: 'file', fileUrl: 'https://x/y.pdf' })
    ).not.toThrow();
  });

  it('requires content for non-file artifacts', () => {
    expect(() => assertArtifactPayload({ type: 'text' })).toThrow(/content/);
    expect(() =>
      assertArtifactPayload({ type: 'markdown', content: '# hi' })
    ).not.toThrow();
  });

  it('allows non-previewable code without a fileName', () => {
    expect(() =>
      assertArtifactPayload({
        type: 'code',
        language: 'python',
        content: 'print(1)'
      })
    ).not.toThrow();
  });

  it('requires a valid fileName for previewable code', () => {
    expect(() =>
      assertArtifactPayload({
        type: 'code',
        language: 'tsx',
        content: 'export default () => null;'
      })
    ).toThrow(/must include fileName/);

    expect(() =>
      assertArtifactPayload({
        type: 'code',
        language: 'tsx',
        content: 'export default () => null;',
        fileName: 'not a path'
      })
    ).toThrow(/valid relative file path/);
  });

  it('rejects disallowed imports in previewable code', () => {
    expect(() =>
      assertArtifactPayload({
        type: 'code',
        language: 'tsx',
        fileName: 'index.tsx',
        content: "import axios from 'axios';\nexport default () => null;"
      })
    ).toThrow(/Unsupported imports: axios/);
  });

  it('requires a .tsx/.jsx fileName when content has JSX', () => {
    expect(() =>
      assertArtifactPayload({
        type: 'code',
        language: 'tsx',
        fileName: 'index.ts',
        content: 'export default () => <div />;'
      })
    ).toThrow(/\.tsx or \.jsx/);

    expect(() =>
      assertArtifactPayload({
        type: 'code',
        language: 'tsx',
        fileName: 'index.tsx',
        content: 'export default () => <div />;'
      })
    ).not.toThrow();
  });
});

describe('blockedHtmlResources', () => {
  it('lets the CDN through and lists every other host', () => {
    const html = `
      <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/normalize/8.0.1/normalize.min.css">
      <script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>
      <script src="https://d3js.org/d3.v7.min.js"></script>
      <script src='//cdn.jsdelivr.net/npm/chart.js'></script>
      <link href="https://fonts.googleapis.com/css2?family=Inter" rel="stylesheet">
      <script>const inline = 1;</script>
    `;
    expect(blockedHtmlResources(html)).toEqual([
      'https://d3js.org/d3.v7.min.js',
      '//cdn.jsdelivr.net/npm/chart.js',
      'https://fonts.googleapis.com/css2?family=Inter'
    ]);
  });

  it('counts a protocol-relative CDN address as blocked', () => {
    expect(
      blockedHtmlResources(
        '<script src="//cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>'
      )
    ).toHaveLength(1);
  });
});

describe('assertArtifactPayload, for HTML', () => {
  it('refuses a script from another host, naming it', () => {
    expect(() =>
      assertArtifactPayload({
        type: 'html',
        content: '<script src="https://d3js.org/d3.v7.min.js"></script>'
      })
    ).toThrow(/only from https:\/\/cdnjs\.cloudflare\.com[\s\S]*d3js\.org/);
  });

  it('keeps a page that loads from the CDN, or nothing', () => {
    expect(() =>
      assertArtifactPayload({
        type: 'html',
        content:
          '<script src="https://cdnjs.cloudflare.com/ajax/libs/d3/7.9.0/d3.min.js"></script>'
      })
    ).not.toThrow();
    expect(() =>
      assertArtifactPayload({
        type: 'code',
        language: 'svg',
        content: '<svg/>'
      })
    ).not.toThrow();
  });
});

describe('dataPartForModel', () => {
  it('tells the model which artifact a preview error came from, and how to fix it', () => {
    const part = dataPartForModel({
      type: 'data-artifactRef',
      data: { id: 'artifact-1' }
    });

    expect(part?.type).toBe('text');
    expect(part?.text).toContain('artifact-1');
    expect(part?.text).toContain('update_artifact');
  });

  it("leaves out every data part that is the page's", () => {
    expect(
      dataPartForModel({
        type: 'data-error',
        data: { kind: 'incomplete', message: 'This response was interrupted.' }
      })
    ).toBeUndefined();
    expect(
      dataPartForModel({ type: 'data-discard', data: { id: 'artifact-1' } })
    ).toBeUndefined();
  });
});

describe('a fix message, as the chat route hands it to the model', () => {
  it('is the error the reader saw, then the instruction they did not', async () => {
    const messages: ChatMessage[] = [
      {
        id: 'm1',
        role: 'user',
        parts: [
          { type: 'text', text: 'undefinedThing is not defined' },
          { type: 'data-artifactRef', data: { id: 'artifact-1' } }
        ]
      }
    ];

    const [message] = await convertToModelMessages<ChatMessage>(messages, {
      convertDataPart: dataPartForModel
    });

    expect(message.role).toBe('user');
    expect(message.content).toEqual([
      { type: 'text', text: 'undefinedThing is not defined' },
      {
        type: 'text',
        text: expect.stringContaining('artifact with id artifact-1')
      }
    ]);
  });
});
