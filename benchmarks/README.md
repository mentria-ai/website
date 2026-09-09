# Benchmarks

Every number mentria publishes about its engine comes from the public bench page, `/bench/`, in a normal Chrome window on the device named. The exports here are the raw JSON that page writes, unedited.

## How a run works

- The bench page loads a tier with the same options the site's tools use (`src/assets/js/mentria-tiers.js` owns that policy), then runs a fixed prompt set: `short` (30 tokens in, 17 out), `medium` (38 in, 83 out), `long` (44 in, 96 out) and `xlong` (1,489 in, 96 out), each `runs` times.
- Decode tok/s is measured from the first generated token to the last; TTFT is the wall time to the first token. Per-token counters split the wall time into CPU encode, record, submit and GPU wait (`syncMs`), so a change can be attributed to the GPU or to the browser.
- Every kernel change ships only if the greedy output is byte-identical to the previous build and to the llama.cpp reference runtime on the same GGUF. The bench compares sample text for that.
- Numbers are unpinned: default power plan, no clock locks, the machine as a person would use it. Medians of repeated runs are the headline; single runs are shown so the spread is visible.

## RTX 3060 Laptop GPU, 6 GB, Windows 11, Chrome 152 on D3D12 (2026-09-08/09)

| File | What it shows |
|---|---|
| `phys-livepolicy.json` | The shipped state: 27B, 3,072-token window, standard set, 26 / 32 / 32 tok/s, load 8.7 s from cache |
| `phys-ctl3072.json`, `phys-full3072.json` | Long prompts at 3,072 before and after the memory work (the slow state at 11 tok/s vs 24) |
| `phys-slotsWB2048.json` | The upload-path change: same bytes on the GPU, 2.4 GB less system RAM |
| `iso-covered.json`, `iso-visible.json` | Bench tab covered vs visible: identical decode, occlusion is not a factor for the worker |
| `iso-batch1.json`, `iso-batch16.json` | Readback cadence 1 vs 16: the memory stall is a fixed cost per submit, not per token |
| `prefill2-ctl.json`, `prefill2-arow.json` | Prompt stage: 1,489 tokens in 29.6 s vs 25.3 s with the retiled kernel |
| `lut-1-ctl.json`, `skew-2-skew.json` | Decode: 15 tok/s before the table-driven kernel, 32 after it plus the bank-conflict skew |

The engine write-ups that go with these, station by station: https://mentria.ai/assets/learn/engine-facts.html
