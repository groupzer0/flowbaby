# Third-Party Software Notices

This file contains notices for third-party software used by Flowbaby.

---

## Cognee

**Project:** Cognee  
**Repository:** https://github.com/topoteretes/cognee  
**License:** Apache License 2.0  
**Copyright:** Copyright 2024 Topoteretes UG

Cognee is a runtime dependency installed via pip. It is not bundled with this extension.

### Apache License 2.0

```
Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
```

The full Apache 2.0 license text is available at:
https://www.apache.org/licenses/LICENSE-2.0

---

## D3.js

**Project:** D3.js (Data-Driven Documents)  
**Repository:** https://github.com/d3/d3  
**License:** BSD 3-Clause "New" or "Revised" License  
**Copyright:** Copyright 2010-2020 Mike Bostock

D3.js is bundled with this extension for offline graph visualization. The vendored
files are located in `bridge/assets/d3/` with full provenance documentation.

### Bundled Files

- `d3.v5.min.js` - D3.js v5.16.0
- `d3-contour.v1.min.js` - d3-contour v1.3.2

### BSD 3-Clause License

```
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

---

## Other Dependencies

This extension also uses various npm packages and Python packages as dependencies.
Each package retains its original license. Notable dependencies include:

### Node.js / TypeScript Dependencies
- See `package.json` for the full list
- Most are licensed under MIT or Apache 2.0

### Python Dependencies  
- See `requirements.txt` for the full list
- Licenses vary by package (MIT, Apache 2.0, BSD, etc.)

Users are responsible for reviewing the licenses of all transitive dependencies
when using this software in their projects.
