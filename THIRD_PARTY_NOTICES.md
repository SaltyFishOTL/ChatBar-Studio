# Third-party notices

ChatBar Studio is maintained by SaltyFishOTL and derived from the image studio in [ChatChatBar](https://github.com/SaltyFishOTL/ChatChatBar). The original Android source snapshots and hashes are retained in `reference/`. GPL-3.0-only applies to author-owned code released in this repository; it does not replace third-party licenses or grant rights in third-party names, artwork, models, or data.

## Bundled resources

- **ECDICT**: https://github.com/skywind3000/ECDICT — MIT. Original copyright and license are preserved in `public/data/licenses/prompt_translation_dictionary_LICENSE.txt`. Dictionary metadata includes conversion provenance and hashes.
- **Danbooru Chinese/English tag catalog**: https://github.com/ffdkj/ffdkj-Danbooru_Tag-Chinese-English-Translation-Table — the inherited distribution-permission statement is preserved in `public/data/licenses/danbooru_tag_catalog.txt`. This permission statement is not a blanket GPL relicensing grant for the database. Tag names and metadata retain their upstream attribution; independent reuse must respect the upstream terms.
- **NovelAI tokenizer definitions**: the binary tables were converted by ChatChatBar from `https://novelai.net/tokenizer/compressed/t5_tokenizer.def?v=2&static=true` and `https://novelai.net/tokenizer/compressed/qwen35_tokenizer.def?v=2&static=true`. Their source identities and hashes are retained in `reference/baseline.json`. No separate GPL grant is made for upstream tokenizer/model data.
- **Style previews, style catalog, codex, prompts, and branding**: migrated from the ChatChatBar baseline identified in `reference/baseline.json`. Referenced third-party names and characters remain the property of their respective rightsholders.

## JavaScript dependencies

Exact versions are locked in `package-lock.json`. Dependencies retain their original licenses. The deployable Release ZIP includes `DEPENDENCY_LICENSES.txt` containing the available license and notice files from the installed locked packages, including the build tools that supply runtime code.

No affiliation with or endorsement by NovelAI, OpenAI, Google, or Danbooru is implied. Use of an external API remains subject to that service's terms.
