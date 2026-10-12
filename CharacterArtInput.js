/**
 * CharacterArtInput.js — standalone, no dependencies, works in any modern browser.
 * Extracted from Characters.js ("FILE UPLOAD & PREVIEW").
 *
 * ES MODULE: this file has a default export, so load it with import (not a plain <script> tag):
 *   import CharacterArtInput from "./CharacterArtInput.js";
 *
 * USAGE — call it as a function: (media input id, preview container)
 *
 *   <input type="file" id="myArtInput" accept="image/*,video/*" multiple>
 *   <div id="myPreviews"></div>
 *   <script src="CharacterArtInput.js"></script>
 *   <script>
 *     const art = CharacterArtInput("myArtInput", "myPreviews");
 *     // or with elements / selectors:
 *     // CharacterArtInput(inputEl, document.querySelector(".Art-Previews"));
 *     // CharacterArtInput("myArtInput", "#myPreviews", { onChange: files => {...} });
 *
 *     art.getFiles();   // File[] currently selected
 *     art.clear();      // reset input + previews
 *   </script>
 *
 * Arguments
 *   input      id string or <input type="file"> element
 *   container  element, id string, or CSS selector for where previews render.
 *              If omitted, a container is created right after the input.
 *   options    (optional)
 *     onChange     fn(File[]) on every change
 *     append       true = new picks add to the selection instead of replacing it
 *     injectStyles false = skip built-in CSS (style the classes below yourself)
 *     maxFileSize  bytes per file (default 250 MB)  — reported via onWarning
 *     maxTotalSize bytes total   (default 500 MB)   — reported via onWarning
 *     onWarning    fn({ type: "file"|"total", files, totalSize })
 *
 * Returns a controller:
 *   getFiles()       File[] currently selected (synchronous)
 *   getFilesInfo()   Promise -> [{ file, name, size, mimeType, mediaType, width, height }]
 *                    mediaType is "image" or "video"; width/height are in pixels
 *                    (null if the browser couldn't read them, e.g. HEIC on desktop Chrome)
 *   getFileNames(), clear(), destroy(), input, previews
 *
 * Static helpers
 *   CharacterArtInput.watchMedia(el, expectedPath)  console.errors the expected path if an
 *                    <img>/<video> fails to load. Use it where you display saved art.
 *
 * CSS classes used: Art-Previews, Art-Preview-Con, Preview-Img, Preview-Vid, remove-btn, Hide
 */
(function (global) {
    "use strict";

    // ── File format detection helpers ───────────────────────────────────────
    var VIDEO_EXT = [".mp4", ".mov", ".avi", ".mkv", ".webm", ".flv", ".wmv", ".m4v", ".3gp", ".mpeg", ".mpg", ".ogv"];
    var IMAGE_EXT = [".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg", ".ico", ".tiff", ".tif", ".heic", ".heif", ".avif"];

    function extOf(name) {
        var i = (name || "").lastIndexOf(".");
        return i < 0 ? "" : name.toLowerCase().substring(i);
    }
    function isVideoFile(name) { return VIDEO_EXT.indexOf(extOf(name)) > -1; }
    function isImageFile(name) { return IMAGE_EXT.indexOf(extOf(name)) > -1; }

    // Some browsers/devices (notably iOS) give an empty file.type — fall back to extension.
    function mediaType(file) {
        var mime = file.type || "";
        if (mime.indexOf("image/") === 0 || (!mime && isImageFile(file.name))) return "image";
        if (mime.indexOf("video/") === 0 || (!mime && isVideoFile(file.name))) return "video";
        return null;
    }

    // ── Default styles (injected once) ──────────────────────────────────────
    function injectStyles() {
        if (document.getElementById("cai-styles")) return;
        var s = document.createElement("style");
        s.id = "cai-styles";
        s.textContent =
            ".Art-Previews{display:flex;flex-wrap:wrap;gap:10px;margin-top:12px}" +
            ".Art-Previews.Hide{display:none}" +
            ".Art-Preview-Con{position:relative;width:200px;height:200px;border:2px solid #000;border-radius:8px;overflow:hidden;background:#eee}" +
            ".Preview-Img,.Preview-Vid{width:100%;height:100%;object-fit:cover;display:block}" +
            ".Art-Preview-Con .remove-btn{position:absolute;top:4px;right:4px;width:24px;height:24px;line-height:24px;" +
            "text-align:center;font-size:18px;font-weight:normal;color:#fff;background:rgba(0,0,0,.75);border-radius:50%;" +
            "cursor:pointer;user-select:none;-webkit-user-select:none;-webkit-tap-highlight-color:transparent}";
        (document.head || document.documentElement).appendChild(s);
    }

    // ── Dimension measuring ─────────────────────────────────────────────────
    // Measured once per File (cached) as soon as it is picked; getFilesInfo() awaits the results.
    var infoCache = new WeakMap();

    function measure(file) {
        var cached = infoCache.get(file);
        if (cached) return cached;

        var type = mediaType(file);
        var p = new Promise(function (resolve) {
            var url = URL.createObjectURL(file);
            var el = type === "image" ? new Image() : document.createElement("video");
            var done = false;
            var timer = null;

            function finish(w, h) {
                if (done) return;
                done = true;
                clearTimeout(timer);
                el.onload = el.onerror = el.onloadedmetadata = null;
                if (type === "video") { el.removeAttribute("src"); try { el.load(); } catch (e) {} }
                URL.revokeObjectURL(url);
                resolve({ width: w || null, height: h || null });
            }

            timer = setTimeout(function () { finish(null, null); }, 15000); // never hang

            if (type === "image") {
                el.onload  = function () { finish(el.naturalWidth, el.naturalHeight); };
                el.onerror = function () { finish(null, null); };
                el.src = url;
            } else {
                el.preload = "metadata";
                el.muted = true;
                el.playsInline = true;
                el.onloadedmetadata = function () { finish(el.videoWidth, el.videoHeight); };
                el.onerror = function () { finish(null, null); };
                el.src = url;
            }
        });

        infoCache.set(file, p);
        return p;
    }

    // ── Missing / unloadable media logging ──────────────────────────────────
    // Logs the path/URL the element expected whenever an <img> or <video> fails to load.
    // Also exposed as CharacterArtInput.watchMedia(el, expectedPath) for use when you
    // display saved art (pass the stored path, so the log shows where the file should be).
    function watchMedia(el, expectedPath, label) {
        var kind = el.tagName === "VIDEO" ? "video" : "image";
        el.addEventListener("error", function () {
            var detail = el.error ? " (code " + el.error.code + (el.error.message ? ": " + el.error.message : "") + ")" : "";
            console.error(
                "CharacterArtInput: " + kind + " not found or could not be loaded" + (label ? " [" + label + "]" : "") +
                ". Expected path: " + (expectedPath || el.currentSrc || el.src || "(none)") + detail
            );
        });
        return el;
    }

    // ── Main ────────────────────────────────────────────────────────────────
    function CharacterArtInput(target, container, options) {
        // Allow CharacterArtInput(input, { ...options }) with no container
        if (container && !(container instanceof Element) && typeof container === "object") {
            options = container;
            container = null;
        }
        options = options || {};
        var input = typeof target === "string" ? document.getElementById(target) : target;
        if (!input) throw new Error("CharacterArtInput: input not found: " + target);
        if (input._characterArtInput) return input._characterArtInput; // already attached

        if (options.injectStyles !== false) injectStyles();

        var maxFile  = options.maxFileSize  || 250 * 1024 * 1024;
        var maxTotal = options.maxTotalSize || 500 * 1024 * 1024;

        // Preview container
        var previews = container || options.previews;
        if (typeof previews === "string") {
            // try as an element id first, then as a CSS selector
            previews = document.getElementById(previews) ||
                       (function () { try { return document.querySelector(container || options.previews); } catch (e) { return null; } })();
            if (!previews) throw new Error("CharacterArtInput: preview container not found: " + (container || options.previews));
        }
        var createdPreviews = false;
        if (!previews) {
            previews = document.createElement("div");
            previews.className = "Art-Previews";
            input.insertAdjacentElement("afterend", previews);
            createdPreviews = true;
        }

        var objectURLs = [];
        var selectedFiles = [];

        function revokeAll() {
            objectURLs.forEach(function (u) { URL.revokeObjectURL(u); });
            objectURLs = [];
        }
        // Single place that shows/hides the container. Uses the Hide class AND an inline
        // display:none so it stays hidden even if your CSS has no .Hide rule.
        function setVisible(show) {
            previews.classList.toggle("Hide", !show);
            previews.style.display = show ? "" : "none";
        }
        function pauseVideos() {
            previews.querySelectorAll("video").forEach(function (v) { v.pause(); });
        }

        function notify() {
            var total = selectedFiles.reduce(function (n, f) { return n + f.size; }, 0);
            if (typeof options.onWarning === "function") {
                var big = selectedFiles.filter(function (f) { return f.size > maxFile; });
                if (big.length) options.onWarning({ type: "file", files: big, totalSize: total });
                else if (total > maxTotal) options.onWarning({ type: "total", files: selectedFiles.slice(), totalSize: total });
            }
            if (typeof options.onChange === "function") options.onChange(selectedFiles.slice());
        }

        // Keep the real <input>.files in sync (DataTransfer is supported in all modern browsers)
        function syncInput() {
            try {
                var dt = new DataTransfer();
                selectedFiles.forEach(function (f) { dt.items.add(f); });
                input.files = dt.files;
            } catch (e) { /* older browsers: controller.getFiles() remains the source of truth */ }
        }

        function createPreview(file, type) {
            var url = URL.createObjectURL(file);
            objectURLs.push(url);

            var con = document.createElement("div");
            var media = document.createElement(type === "image" ? "img" : "video");
            var removeBtn = document.createElement("div");

            con.className = "Art-Preview-Con";
            removeBtn.className = "remove-btn";
            removeBtn.textContent = "\u00d7";

            removeBtn.addEventListener("click", function () {
                // Re-derive the index at removal time; earlier removals make any captured index stale.
                var idx = selectedFiles.indexOf(file);
                if (idx > -1) selectedFiles.splice(idx, 1);
                syncInput();

                var u = objectURLs.indexOf(url);
                if (u > -1) { URL.revokeObjectURL(url); objectURLs.splice(u, 1); }
                if (type === "video") media.pause();

                con.remove();
                if (!previews.children.length) setVisible(false);
                notify();
            });

            watchMedia(media, url, file.name + ", " + (file.type || "unknown type"));

            if (type === "image") {
                media.className = "Preview-Img";
                media.src = url;
            } else {
                media.className = "Preview-Vid";
                media.src = url;
                media.playsInline = true;
                media.muted = true;
                media.autoplay = true;
                media.loop = true;
                var p = media.play();
                if (p && p.catch) p.catch(function () {});
            }

            con.appendChild(media);       // media first so the × paints on top
            con.appendChild(removeBtn);
            previews.appendChild(con);
        }

        function render() {
            pauseVideos();
            revokeAll();
            previews.innerHTML = "";
            var shown = 0;
            selectedFiles.forEach(function (file) {
                var type = mediaType(file);
                if (!type) return;
                createPreview(file, type);
                shown++;
            });
            setVisible(shown > 0);
        }

        function onInputChange() {
            var picked = Array.from(input.files || []).filter(function (f) { return mediaType(f); });
            if (options.append) {
                // avoid duplicates (same name+size+lastModified)
                picked.forEach(function (f) {
                    var dup = selectedFiles.some(function (s) {
                        return s.name === f.name && s.size === f.size && s.lastModified === f.lastModified;
                    });
                    if (!dup) selectedFiles.push(f);
                });
                syncInput();
            } else {
                selectedFiles = picked;
            }
            render();
            selectedFiles.forEach(measure); // start reading dimensions in the background
            notify();
        }

        input.addEventListener("change", onInputChange);
        setVisible(false); // nothing selected yet — start hidden

        var controller = {
            input: input,
            previews: previews,
            getFiles: function () { return selectedFiles.slice(); },
            getFilesInfo: function () {
                var files = selectedFiles.slice();
                return Promise.all(files.map(function (file) {
                    return measure(file).then(function (d) {
                        return {
                            file: file,
                            name: file.name,
                            size: file.size,
                            mimeType: file.type || "",
                            mediaType: mediaType(file),   // "image" | "video"
                            width: d.width,
                            height: d.height
                        };
                    });
                }));
            },
            getFileNames: function () { return selectedFiles.map(function (f) { return f.name; }); },
            clear: function () {
                selectedFiles = [];
                render();
                input.value = "";
                notify();
            },
            destroy: function () {
                input.removeEventListener("change", onInputChange);
                pauseVideos();
                revokeAll();
                previews.innerHTML = "";
                if (createdPreviews) previews.remove();
                else setVisible(false);
                delete input._characterArtInput;
            }
        };

        window.addEventListener("pagehide", function () {
            pauseVideos();
            revokeAll();
        });

        input._characterArtInput = controller;
        return controller;
    }

    CharacterArtInput.attach = CharacterArtInput; // alias
    CharacterArtInput.watchMedia = watchMedia;
    CharacterArtInput.isImageFile = isImageFile;
    CharacterArtInput.isVideoFile = isVideoFile;
    global.CharacterArtInput = CharacterArtInput;
})(typeof window !== "undefined" ? window : globalThis);

export default globalThis.CharacterArtInput;