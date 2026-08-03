const aliases = {
  '@app/': new URL('../src/app/', import.meta.url),
  '@data/': new URL('../src/data/', import.meta.url),
  '@domain/': new URL('../src/domain/', import.meta.url),
  '@features/': new URL('../src/features/', import.meta.url),
  '@shared/': new URL('../src/shared/', import.meta.url),
};

export async function resolve(specifier, context, nextResolve) {
  for (const [prefix, baseUrl] of Object.entries(aliases)) {
    if (specifier.startsWith(prefix)) {
      const relativePath = specifier.slice(prefix.length);
      return nextResolve(new URL(relativePath, baseUrl).href, context);
    }
  }

  return nextResolve(specifier, context);
}
