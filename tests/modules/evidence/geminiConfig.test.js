const { resolveGeminiApiKey, resolveGeminiModels } = require('../../../src/modules/evidence/aiExtractor');

describe('Gemini configuration (no embedded key)', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it('uses GEMINI_API_KEY from the environment when set', () => {
    process.env.GEMINI_API_KEY = 'env-key';
    expect(resolveGeminiApiKey()).toBe('env-key');
  });

  it('returns null outside tests when GEMINI_API_KEY is missing (no hardcoded fallback)', () => {
    delete process.env.GEMINI_API_KEY;
    process.env.NODE_ENV = 'production';
    expect(resolveGeminiApiKey()).toBeNull();
  });

  it('uses a mock key only under NODE_ENV=test', () => {
    delete process.env.GEMINI_API_KEY;
    process.env.NODE_ENV = 'test';
    expect(resolveGeminiApiKey()).toBe('test-mock-gemini-key');
  });

  it('defaults to supported models and never to retired 1.5/2.0 models', () => {
    delete process.env.GEMINI_MODEL;
    delete process.env.GEMINI_FALLBACK_MODELS;
    const models = resolveGeminiModels();
    expect(models[0]).toBe('gemini-3.5-flash');
    expect(models.some((m) => /gemini-(1\.5|2\.0)/.test(m))).toBe(false);
  });

  it('honours GEMINI_MODEL and GEMINI_FALLBACK_MODELS without duplicates', () => {
    process.env.GEMINI_MODEL = 'model-a';
    process.env.GEMINI_FALLBACK_MODELS = 'model-b, model-a ,model-c';
    expect(resolveGeminiModels()).toEqual(['model-a', 'model-b', 'model-c']);
  });
});
