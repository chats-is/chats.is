/**
 * Writes `src/types/provider-options.gen.ts`: the AI SDK's own provider
 * options, as zod schemas, for each kind of call the app makes through a
 * provider of each type.
 *
 * The SDK checks a call's provider options against schemas it keeps to itself
 * and exports only as TypeScript types, so the schemas are read back from
 * those types, by the compiler, out of the installed packages. Run it after
 * upgrading them — a test fails while the file is behind:
 *
 *   pnpm gen:provider-options
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ts from 'typescript';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const OUTPUT = join(ROOT, 'src/types/provider-options.gen.ts');

/**
 * The option types each provider type is called with: its chat model's, and
 * each media model's the SDK has for it — every one of them is handed the
 * same `apiOptions`. Video through OpenAI and Azure is not the SDK's, and
 * takes none.
 */
const SOURCES: Record<string, Array<[module: string, type: string]>> = {
  openai: [
    ['@ai-sdk/openai', 'OpenAILanguageModelResponsesOptions'],
    ['@ai-sdk/openai', 'OpenAIImageModelGenerationOptions'],
    ['@ai-sdk/openai', 'OpenAIImageModelEditOptions'],
    ['@ai-sdk/openai', 'OpenAISpeechModelOptions'],
    ['@ai-sdk/openai', 'OpenAITranscriptionModelOptions']
  ],
  azure: [
    ['@ai-sdk/azure', 'OpenAILanguageModelResponsesOptions'],
    ['@ai-sdk/azure', 'AzureImageModelOptions'],
    ['@ai-sdk/azure', 'AzureSpeechModelOptions'],
    ['@ai-sdk/azure', 'AzureTranscriptionModelOptions']
  ],
  google: [
    ['@ai-sdk/google', 'GoogleLanguageModelOptions'],
    ['@ai-sdk/google', 'GoogleImageModelOptions'],
    ['@ai-sdk/google', 'GoogleVideoModelOptions'],
    ['@ai-sdk/google', 'GoogleSpeechModelOptions'],
    ['@ai-sdk/google', 'GoogleTranscriptionModelOptions']
  ],
  vertex: [
    ['@ai-sdk/google', 'GoogleLanguageModelOptions'],
    ['@ai-sdk/google-vertex', 'GoogleVertexImageModelOptions'],
    ['@ai-sdk/google-vertex', 'GoogleVertexVideoModelOptions'],
    ['@ai-sdk/google-vertex', 'GoogleVertexSpeechModelOptions'],
    ['@ai-sdk/google-vertex', 'GoogleVertexTranscriptionModelOptions'],
    ['@ai-sdk/google-vertex', 'GoogleVertexTranscriptionModelGeminiOptions']
  ],
  anthropic: [['@ai-sdk/anthropic', 'AnthropicLanguageModelOptions']],
  bedrock: [
    ['@ai-sdk/amazon-bedrock', 'AmazonBedrockLanguageModelChatOptions'],
    ['@ai-sdk/amazon-bedrock', 'AmazonBedrockImageModelOptions']
  ],
  xai: [
    ['@ai-sdk/xai', 'XaiLanguageModelResponsesOptions'],
    ['@ai-sdk/xai', 'XaiImageModelOptions'],
    ['@ai-sdk/xai', 'XaiVideoModelOptions'],
    ['@ai-sdk/xai', 'XaiSpeechModelOptions'],
    ['@ai-sdk/xai', 'XaiTranscriptionModelOptions']
  ],
  deepseek: [['@ai-sdk/deepseek', 'DeepSeekLanguageModelChatOptions']]
};

/** A module that names every type above, compiled in place of a real file. */
function entrySource() {
  return Object.values(SOURCES)
    .flat()
    .map(
      ([module, type], i) => `export type T${i} = import('${module}').${type};`
    )
    .join('\n');
}

const indent = (depth: number) => '  '.repeat(depth);

/** A JSON value's zod schema, written out from the type the SDK declares. */
function zodOf(
  checker: ts.TypeChecker,
  type: ts.Type,
  depth: number,
  seen: Set<ts.Type>
): string {
  const { flags } = type;
  if (flags & (ts.TypeFlags.Any | ts.TypeFlags.Unknown)) return 'z.unknown()';
  // A key one form of the options must leave out (`mode?: never`).
  if (flags & ts.TypeFlags.Never) return 'z.never()';
  if (flags & ts.TypeFlags.Undefined) return 'z.undefined()';
  if (flags & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral))
    return 'z.string()';
  if (flags & ts.TypeFlags.Number) return 'z.number()';
  if (flags & ts.TypeFlags.Boolean) return 'z.boolean()';
  if (flags & ts.TypeFlags.Null) return 'z.null()';
  if (type.isStringLiteral()) return `z.literal(${JSON.stringify(type.value)})`;
  if (type.isNumberLiteral()) return `z.literal(${type.value})`;
  if (flags & ts.TypeFlags.BooleanLiteral)
    return `z.literal(${checker.typeToString(type)})`;

  if (type.isUnion()) {
    let members = type.types.filter(
      t => !(t.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void))
    );
    // `boolean` reaches a union as its two literals.
    const literals = members.filter(t => t.flags & ts.TypeFlags.BooleanLiteral);
    const hasBoolean = literals.length === 2;
    if (hasBoolean) members = members.filter(t => !literals.includes(t));
    // A choice of words is one enum, beside whatever else the union takes.
    const words = members.filter(t => t.isStringLiteral());
    if (words.length > 1) members = members.filter(t => !t.isStringLiteral());
    // A null beside the rest is `.nullable()`, so a wrong value is told what
    // it should have been rather than only that it is not one of several.
    const nullable = members.some(t => t.flags & ts.TypeFlags.Null);
    if (nullable) members = members.filter(t => !(t.flags & ts.TypeFlags.Null));
    const parts = members.map(t => zodOf(checker, t, depth, seen));
    if (words.length > 1) {
      parts.push(
        `z.enum([${words.map(t => JSON.stringify(t.value)).join(', ')}])`
      );
    }
    if (hasBoolean) parts.push('z.boolean()');
    if (parts.length === 0) return 'z.null()';
    const schema =
      parts.length === 1 ? parts[0] : `z.union([${parts.join(', ')}])`;
    return nullable ? `${schema}.nullable()` : schema;
  }

  // `string & {}`, the SDK's way of offering suggestions while taking any
  // string, is a string.
  if (type.isIntersection()) {
    const primitive = type.types.find(
      t => t.flags & (ts.TypeFlags.String | ts.TypeFlags.Number)
    );
    if (primitive) return zodOf(checker, primitive, depth, seen);
  }

  if (checker.isArrayType(type)) {
    const [item] = checker.getTypeArguments(type as ts.TypeReference);
    return `z.array(${zodOf(checker, item, depth, seen)})`;
  }
  if (checker.isTupleType(type)) {
    const items = checker.getTypeArguments(type as ts.TypeReference);
    return `z.tuple([${items.map(t => zodOf(checker, t, depth, seen)).join(', ')}])`;
  }

  // A type that contains itself — a JSON value — takes any value from there.
  if (seen.has(type)) return 'z.unknown()';
  const inner = new Set(seen).add(type);

  const properties = checker
    .getPropertiesOfType(type)
    .filter(p => checker.getTypeOfSymbol(p).getCallSignatures().length === 0);
  const index = checker
    .getIndexInfosOfType(type)
    .find(info => info.keyType.flags & ts.TypeFlags.String);
  const rest = index && zodOf(checker, index.type, depth, inner);
  if (properties.length === 0) {
    return rest ? `z.record(z.string(), ${rest})` : 'z.unknown()';
  }

  const fields = properties.map(p => {
    const propertyType = checker.getTypeOfSymbol(p);
    const optional =
      p.flags & ts.SymbolFlags.Optional ||
      (propertyType.isUnion() &&
        propertyType.types.some(t => t.flags & ts.TypeFlags.Undefined));
    const key = /^[A-Za-z_$][\w$]*$/.test(p.name)
      ? p.name
      : JSON.stringify(p.name);
    const schema = zodOf(checker, propertyType, depth + 1, inner);
    return `${indent(depth + 1)}${key}: ${schema}${optional ? '.optional()' : ''}`;
  });
  const body = `{\n${fields.join(',\n')}\n${indent(depth)}}`;
  // Strict, so a misspelt key is told rather than dropped — the SDK itself
  // drops keys it does not know without a word.
  return rest
    ? `z.object(${body}).catchall(${rest})`
    : `z.strictObject(${body})`;
}

/** The generated file's contents, from the packages installed now. */
export function generate(): string {
  const entry = join(ROOT, '__provider-options__.ts');
  const options: ts.CompilerOptions = {
    strict: true,
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    skipLibCheck: true,
    noEmit: true
  };
  const host = ts.createCompilerHost(options);
  const source = entrySource();
  const { getSourceFile, fileExists, readFile } = host;
  host.getSourceFile = (fileName, ...rest) =>
    fileName === entry
      ? ts.createSourceFile(fileName, source, ts.ScriptTarget.ES2022)
      : getSourceFile(fileName, ...rest);
  host.fileExists = fileName => fileName === entry || fileExists(fileName);
  host.readFile = fileName =>
    fileName === entry ? source : readFile(fileName);

  const program = ts.createProgram([entry], options, host);
  const checker = program.getTypeChecker();
  const named = checker.getExportsOfModule(
    checker.getSymbolAtLocation(program.getSourceFile(entry)!)!
  );

  // One schema per distinct type: a type two provider types share (Gemini's
  // options on Google and Vertex alike) is written once.
  const schemas = new Map<string, string>(); // code → name
  const all = Object.values(SOURCES).flat();
  const byProvider = Object.entries(SOURCES).map(([provider, pairs]) => {
    const names = pairs.map(pair => {
      const [module, typeName] = pair;
      const symbol = named.find(s => s.name === `T${all.indexOf(pair)}`)!;
      const type = checker.getDeclaredTypeOfSymbol(symbol);
      if (type.flags & ts.TypeFlags.Any) {
        throw new Error(`${module} has no ${typeName}`);
      }
      const code = zodOf(checker, type, 1, new Set());
      let name = schemas.get(code);
      if (!name) {
        const taken = new Set(schemas.values());
        name = taken.has(typeName)
          ? `${typeName}_${module.replace(/\W/g, '_')}`
          : typeName;
        schemas.set(code, name);
      }
      return name;
    });
    return `  ${provider}: [${names.map(n => `SCHEMAS.${n}`).join(', ')}]`;
  });

  return [
    '// Written by scripts/gen-provider-options.ts from the installed AI SDK',
    '// packages — not edited by hand. Run `pnpm gen:provider-options` after',
    '// upgrading them.',
    '',
    "import { z } from 'zod';",
    '',
    'const SCHEMAS = {',
    [...schemas].map(([code, name]) => `  ${name}: ${code}`).join(',\n'),
    '};',
    '',
    '/** The AI SDK option schemas a provider of each type is called with. */',
    'export const PROVIDER_OPTION_SCHEMAS = {',
    byProvider.join(',\n'),
    '};',
    ''
  ].join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const next = generate();
  const changed = !existsSync(OUTPUT) || readFileSync(OUTPUT, 'utf8') !== next;
  writeFileSync(OUTPUT, next);
  console.log(changed ? `Wrote ${OUTPUT}` : `${OUTPUT} is up to date`);
}
