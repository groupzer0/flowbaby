# D3.js Vendored Assets - Provenance Record

This directory contains vendored D3.js libraries for offline-first graph visualization.

## Purpose

These assets are bundled to ensure the Flowbaby extension operates entirely offline without requiring CDN access. This supports:
- Privacy: No external network requests during visualization
- Reliability: Graph visualization works without internet connectivity
- Security: No dependency on third-party CDN availability or integrity

## Vendored Libraries

### d3.v5.min.js
- **Source**: https://d3js.org/d3.v5.min.js
- **Version**: 5.16.0
- **License**: BSD-3-Clause
- **Copyright**: Copyright 2020 Mike Bostock
- **Retrieved**: 2025-01-18
- **SHA256**: 5dbe924b3847df010f0b8572dd6ef42ea87d6370eeff72b13ea236247412a53c

### d3-contour.v1.min.js
- **Source**: https://d3js.org/d3-contour.v1.min.js
- **Version**: 1.3.2
- **License**: BSD-3-Clause
- **Copyright**: Copyright 2018 Mike Bostock
- **Retrieved**: 2025-01-18
- **SHA256**: 0d1166a79eb18acf8db5c3091b7eb8cdbdb7159d9656d229e20bb3ef97a0a22f

## License Terms

D3.js is licensed under the BSD 3-Clause "New" or "Revised" License:

```
Copyright 2010-2020 Mike Bostock
All rights reserved.

Redistribution and use in source and binary forms, with or without modification,
are permitted provided that the following conditions are met:

* Redistributions of source code must retain the above copyright notice, this
  list of conditions and the following disclaimer.

* Redistributions in binary form must reproduce the above copyright notice,
  this list of conditions and the following disclaimer in the documentation
  and/or other materials provided with the distribution.

* Neither the name of the author nor the names of contributors may be used to
  endorse or promote products derived from this software without specific prior
  written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT OWNER OR CONTRIBUTORS BE LIABLE FOR
ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
(INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES;
LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON
ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
(INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS
SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

## Verification

To verify the integrity of these files:

1. Download fresh copies from the official CDN
2. Compare SHA256 checksums
3. Ensure version headers match expected versions

## Usage

These assets are inlined into the graph visualization HTML by `visualize.py` during post-processing to replace Cognee's CDN `<script>` references.
