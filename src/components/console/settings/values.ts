/**
 * A setting key is a dotted path — `app.name`, `default.chat.modelId` — and
 * that is exactly how a form addresses a nested field. So the keys are
 * expanded into an object on the way into the form and read back out by the
 * same path on the way to the server, and a page can name its fields with the
 * setting key itself.
 */

/**
 * A settings page's values: the dotted keys expanded into the object the form
 * addresses. The shape differs per page, so it is only known as a tree.
 */
export type SettingsValues = Record<string, unknown>;

/** `{ 'app.name': 'x' }` → `{ app: { name: 'x' } }`. */
export function expand(flat: Record<string, string>): SettingsValues {
  const out: SettingsValues = {};

  for (const [key, value] of Object.entries(flat)) {
    const path = key.split('.');
    let node = out;

    for (const segment of path.slice(0, -1)) {
      node[segment] ??= {};
      node = node[segment] as SettingsValues;
    }

    node[path[path.length - 1]] = value;
  }

  return out;
}

/**
 * The value at a dotted key, back out of the expanded object. A key that names
 * nothing, or names a branch rather than a leaf, reads as empty — a branch
 * must never be sent to the server as a setting's value.
 */
export function readPath(values: SettingsValues, key: string): string {
  const found = key
    .split('.')
    .reduce<unknown>(
      (node, segment) =>
        node && typeof node === 'object'
          ? (node as SettingsValues)[segment]
          : undefined,
      values
    );

  return typeof found === 'string' ? found : '';
}
