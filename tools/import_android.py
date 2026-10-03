"""Explicit, reproducible Android resource import; no source mutation."""
from pathlib import Path
import hashlib, json, re, shutil, subprocess, textwrap, sys

source = Path(sys.argv[1]).resolve()
refresh = '--refresh' in sys.argv[2:]
target = Path(__file__).resolve().parents[1]
assets = source / 'app/app/src/main/assets'
java = source / 'app/app/src/main/java/com/example/chatbar'
out = target / 'public/data'
out.mkdir(parents=True, exist_ok=True)
for name in ('tag_completion', 'prompt_dictionary', 'tokenizers', 'licenses'):
    shutil.copytree(assets / name, out / name, dirs_exist_ok=True)
shutil.copytree(assets / 'presets/image_styles/previews', out / 'style-previews', dirs_exist_ok=True)
shutil.copy2(assets / 'presets/novelai/nai-codex-v1.json', out / 'codex.json')
catalog = json.loads((assets / 'presets/image_styles/default-image-styles.json').read_text(encoding='utf-8-sig'))
styles = [{'id': 'preset:' + s['styleKey'], 'name': s['displayName'], 'prompt': s['prompt'], 'negative': s.get('negativePrompt', ''), 'avatar': '/data/style-previews/' + s['previewImage'], 'createdAt': 0, 'updatedAt': 0} for s in catalog['styles']]
(out / 'styles.json').write_text(json.dumps({'cards': styles, 'support': {'preset:' + s['styleKey']: s.get('modelSupport','BOTH') for s in catalog['styles']}}, ensure_ascii=False), encoding='utf-8')
(out / 'style-metadata.json').write_text(json.dumps({'preset:' + s['styleKey']: bool(s.get('negativePrompt', '').strip()) for s in catalog['styles']}, ensure_ascii=False, indent=2), encoding='utf-8')
dictionary_source = (java / 'domain/image/NovelAiPromptWordDictionary.kt').read_text(encoding='utf-8-sig')
words_block = dictionary_source.split('private val WORDS = mapOf(', 1)[1]
words = {json.loads(a): json.loads(b) for a,b in re.findall(r'("(?:\\.|[^"\\])*")\s+to\s+("(?:\\.|[^"\\])*")', words_block)}
(out / 'dictionary-overrides.json').write_text(json.dumps(words, ensure_ascii=False), encoding='utf-8')
raw = (java / 'domain/prompt/PromptTemplates.kt').read_text(encoding='utf-8-sig')
prompts = {}
for match in re.finditer(r'(?:const )?val (\w+)(?:\s*:\s*String)?\s*=\s*(""".*?"""|"(?:\\.|[^"\\])*")', raw, re.S):
    name, value = match.groups()
    if name.startswith(('NOVELAI_', 'GENERAL_', 'DEFAULT_CHARACTER_NAI_', 'IMAGE_DESCRIPTION_PROMPT')):
        prompts[name] = (textwrap.dedent(value[3:-3]).strip() if value.startswith('"""') else json.loads(value)).replace("${'$'}", '$')
for name in ('novelAiImagePromptStyleExclusionSystem', 'novelAiImagePromptReferenceImageUser', 'novelAiImageReversePromptUser'):
    value = re.search(r'fun ' + name + r'\([^)]*\): String\s*=\s*"""(.*?)"""', raw, re.S)
    if value: prompts[name] = textwrap.dedent(value[1]).strip()
v5 = re.search(r'val NOVELAI_IMAGE_PROMPT_SYSTEM_V5: String = NOVELAI_IMAGE_PROMPT_SYSTEM(.*?)\n\s*const val ', raw, re.S)[1]
prompts['NOVELAI_IMAGE_PROMPT_SYSTEM_V5'] = prompts['NOVELAI_IMAGE_PROMPT_SYSTEM']
for pair in re.finditer(r'\.replace\(\s*("(?:\\.|[^"\\])*")\s*,\s*("(?:\\.|[^"\\])*")\s*\)', v5, re.S):
    prompts['NOVELAI_IMAGE_PROMPT_SYSTEM_V5'] = prompts['NOVELAI_IMAGE_PROMPT_SYSTEM_V5'].replace(json.loads(pair[1]), json.loads(pair[2]))
(out / 'prompts.json').write_text(json.dumps(prompts, ensure_ascii=False, indent=2), encoding='utf-8')
refs = target / ('reference/current-android' if refresh else 'reference/android')
files = list((java / 'domain/image').glob('*.kt')) + list((java / 'ui/imageprompt').glob('*.kt')) + [java / 'domain/prompt/PromptTemplates.kt', java / 'data/local/entity/ModelConfig.kt']
files += list((java / 'data/repository').glob('NovelAi*.kt'))
if refresh:
    files += [java / path for path in ('domain/chat/ImageUnderstandingService.kt', 'domain/chat/StreamingChatService.kt', 'domain/prompt/AiTaskRequests.kt', 'domain/card/AiJsonOutputExtractor.kt', 'ui/components/NovelAiPromptRendering.kt')]
records = []
for file in files:
    rel = file.relative_to(java)
    dest = refs / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(file, dest)
    records.append({'path': file.relative_to(source).as_posix(), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest()})
manifest = {'androidCommit': subprocess.check_output(['git','rev-parse','HEAD'],cwd=source,text=True).strip(), 'androidStatus': subprocess.check_output(['git','status','--porcelain'],cwd=source,text=True), 'files': records, 'resources': []}
for file in out.rglob('*'):
    if file.is_file(): manifest['resources'].append({'path': file.relative_to(out).as_posix(), 'sha256': hashlib.sha256(file.read_bytes()).hexdigest(), 'bytes': file.stat().st_size})
(target / 'reference').mkdir(exist_ok=True)
(target / 'reference' / ('current-parity.json' if refresh else 'baseline.json')).write_text(json.dumps(manifest,indent=2), encoding='utf-8')
print(f'Imported {len(styles)} styles, {len(prompts)} prompt constants, {len(records)} source references.')
