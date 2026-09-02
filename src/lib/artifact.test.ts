import { describe, expect, it } from 'vitest';

import {
  artifactKindFromType,
  assertArtifactPayload,
  getArtifactKind,
  isPreviewableCodeArtifact,
  isRelativeImport,
  isStyleImport,
  looksLikeJsx,
  validatePreviewImports
} from './artifact';

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

  it('allows the curated bundled libraries', () => {
    const code = `
      import { Home } from 'lucide-react';
      import { motion } from 'framer-motion';
      import { LineChart } from 'recharts';
      import clsx from 'clsx';
      import { cva } from 'class-variance-authority';
    `;
    expect(validatePreviewImports(code)).toEqual([]);
  });

  it('flags disallowed package imports (deduped)', () => {
    const code = `
      import { format } from 'date-fns';
      import x from 'lodash';
      import y from 'lodash';
      const z = require('axios');
    `;
    const result = validatePreviewImports(code);
    expect(result).toContain('date-fns');
    expect(result).toContain('lodash');
    expect(result).toContain('axios');
    expect(result.filter(s => s === 'lodash')).toHaveLength(1);
  });

  it('flags dynamic import() of a disallowed package', () => {
    const code = "const m = await import('got');";
    expect(validatePreviewImports(code)).toEqual(['got']);
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
