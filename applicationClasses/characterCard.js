import { getCharacter } from '../db'
import { setCurrentPage, showCurrentPage, getUserId } from '../main'

export class CharacterCard {
    static DEFAULT_DESCRIPTION =
        "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur.";

    static DESCRIPTION_PREVIEW_WORDS = 250;
    static SWIPE_THRESHOLD = 50; // px the user must drag before the art switches
    static ART_ROOT = "assets";

    // Only art with this art_purpose is shown on the card
    static CARD_ART_PURPOSE = "character_art";

    // Image extensions tried (in order) when an art_name has no extension.
    // Put your most-used format first to avoid extra failed requests.
    static ART_EXTENSIONS = [
        "png", "jpg", "jpeg", "webp", "avif", "gif", "svg",
        "apng", "jfif", "bmp", "jxl", "heic", "tiff"
    ];

    // Video extensions tried when an art_name has no extension and art_type is "video".
    static VIDEO_EXTENSIONS = ["mp4", "webm", "mov", "m4v", "ogv", "mkv", "3gp"];

    static VIDEO_CONTROLS_HEIGHT = 56; // px at the bottom of a video that belong to the native controls, not the swipe
    static TAP_TOLERANCE = 10;         // px of movement still counted as a tap

    // Gender -> class added to the card container
    static GENDER_CLASSES = {
        male: "genderMaleLabel",
        female: "genderFemaleLabel"
    };

    static SHOW_ALL_TEXT = "SHOW ALL CHARACTER ART";
    static HIDE_ALL_TEXT = "HIDE ALL CHARACTER ART";

    #showingAll = false;
    #resolvedArt = new Map(); // art key -> working path (with extension)
    #pendingArt = new Map();  // art key -> in-flight extension probe, so the same art isn't probed twice

    // "Donovan Mann" -> "donovanMann", "donovan_mann" -> "donovanMann"
    static toCamelCase(name = "") {
        const words = String(name)
            .normalize("NFD")
            .replace(/\p{M}/gu, "") // strip accents (é -> e)
            .split(/[^A-Za-z0-9]+/)
            .filter(Boolean);

        return words
            .map((word, i) => {
                // ALL CAPS words get normalised; mixed-case words (already camelCase) keep their inner capitals
                const rest = word === word.toUpperCase() ? word.slice(1).toLowerCase() : word.slice(1);
                const first = i === 0 ? word[0].toLowerCase() : word[0].toUpperCase();
                return first + rest;
            })
            .join("");
    }

    static #getExtension(path = "") {
        const name = String(path).split(/[?#]/)[0].split("/").pop();
        return name.includes(".") ? name.split(".").pop().toLowerCase() : "";
    }

    // "assets/a/a1.mp4" -> true, "assets/a/a1.png" -> false
    static isVideoPath(path = "") {
        return CharacterCard.VIDEO_EXTENSIONS.includes(CharacterCard.#getExtension(path));
    }

    // True if the name already ends in a known image/video extension ("donovanMann1.png")
    static #hasKnownExtension(name = "") {
        const ext = CharacterCard.#getExtension(name);
        return CharacterCard.ART_EXTENSIONS.includes(ext) || CharacterCard.VIDEO_EXTENSIONS.includes(ext);
    }

    // Turns an art row's aspect_ratio into a CSS aspect-ratio value ("1.7778").
    // Falls back to width / height, and returns "" (no ratio) if neither is usable.
    static #ratioOf(art) {
        if (!art) return "";

        const ratio = Number(art.aspect_ratio);
        if (Number.isFinite(ratio) && ratio > 0) return String(ratio);

        const fallback = Number(art.width) / Number(art.height);
        return Number.isFinite(fallback) && fallback > 0 ? String(fallback) : "";
    }

    // Accepts an array of art rows, or the raw db.query() result ({ values: [...] }).
    // Keeps only the art that should appear on the card.
    static #normalizeArt(artInfo) {
        const rows = Array.isArray(artInfo) ? artInfo : (artInfo?.values ?? []);
        return rows.filter((art) => art?.art_purpose === CharacterCard.CARD_ART_PURPOSE);
    }

    // Resolves true if the browser can load `path` as an image or video
    static #canLoad(path, isVideo) {
        return new Promise((resolve) => {
            const el = isVideo ? document.createElement("video") : new Image();

            const done = (ok) => {
                el.onload = el.onerror = el.onloadedmetadata = null;
                if (isVideo) {
                    el.removeAttribute("src"); // stop the download
                    el.load();
                }
                resolve(ok);
            };

            if (isVideo) {
                el.preload = "metadata";
                el.onloadedmetadata = () => done(true);
            } else {
                el.onload = () => done(true);
            }
            el.onerror = () => done(false);
            el.src = path;
        });
    }

    // characterArtArr is an array of art objects (rows from the `art` table), e.g.
    // { id, art_name, width, height, aspect_ratio, art_type, art_purpose, ... }.
    // Art whose art_purpose isn't "character_art" is ignored.
    constructor(characterId, characterName, characterArtArr = [], characterGender, characterDescription, characterTags = [], characterView = null) {
        this.characterId = characterId;
        this.characterName = characterName;
        this.characterKey = CharacterCard.toCamelCase(characterName); // folder name

        this.characterArtArr = CharacterCard.#normalizeArt(characterArtArr);

        this.characterGender = characterGender;
        this.characterDescription = characterDescription; // full text is kept here
        this.characterTags = characterTags;
        this.characterView = characterView; // element or element ID
        this.currentArtIndex = 0;

        // Containers
        this.cardContainer = document.createElement("div");
        this.cardTitleContainer = document.createElement("div");
        this.cardArtContainer = document.createElement("div");
        this.cardShowAllBtnContainer = document.createElement("div");
        this.cardMainBtnsContainer = document.createElement("div");
        this.cardDescriptionContainer = document.createElement("div");
        this.cardTagsContainer = document.createElement("div");

        // Elements
        this.cardTitle = document.createElement("p");
        this.cardArt = document.createElement("img");
        this.cardVideo = this.#createVideo();
        this.showAllBtn = document.createElement("button");
        this.profileBtn = document.createElement("button");
        this.boardBtn = document.createElement("button");
        this.descriptionTextarea = document.createElement("textarea");

        this.cardContainer.addEventListener("click", async () => {
            const userId = await getUserId()
            const res = await getCharacter(userId, this.characterId);
            if (res.ok) {
                console.log(res.userCharacter)
            }
        });

        this.profileBtn.addEventListener("click", async () => {
            setCurrentPage("profilePage");
            await showCurrentPage();
            this.#setCurrentCharacterProfile();
        });

        this.#build();
    }

    #build() {
        // Classes
        this.cardContainer.classList.add("Character-Card");
        this.#applyGenderClass();
        this.cardShowAllBtnContainer.classList.add("Character-Card-Show-All-Btn-Con");
        this.cardMainBtnsContainer.classList.add("Character-Card-Profile-Board-Btns-Con");
        this.cardTagsContainer.classList.add("Character-Card-Tags-Container");
        this.cardArtContainer.classList.add("Character-Art-Container");

        // Title
        this.cardTitle.textContent = this.characterName;
        this.cardTitleContainer.append(this.cardTitle);

        // Art (swipeable)
        this.#renderArt();
        this.cardArtContainer.append(this.cardArt);
        this.#setupSwipe();

        // Show / hide all art button
        this.showAllBtn.textContent = CharacterCard.SHOW_ALL_TEXT;
        this.showAllBtn.addEventListener("click", () => this.toggleAllArt());
        this.cardShowAllBtnContainer.append(this.showAllBtn);

        // Profile / Board buttons
        this.profileBtn.textContent = "PROFILE";
        this.boardBtn.textContent = "BOARD";
        this.cardMainBtnsContainer.append(this.profileBtn, this.boardBtn);

        // Description (read-only, auto-sizing preview)
        this.descriptionTextarea.readOnly = true;
        this.descriptionTextarea.rows = 1;
        this.descriptionTextarea.style.resize = "none";
        this.descriptionTextarea.style.overflow = "hidden";
        this.descriptionTextarea.style.boxSizing = "border-box";
        this.#renderDescription();
        this.cardDescriptionContainer.append(this.descriptionTextarea);
        this.#observeWidth();

        // Tags
        this.#renderTags();

        // Assemble card in the same order as the HTML
        this.cardContainer.append(
            this.cardTitleContainer,
            this.cardArtContainer,
            this.cardShowAllBtnContainer,
            this.cardMainBtnsContainer,
            this.cardDescriptionContainer,
            this.cardTagsContainer
        );
    }

    #createVideo() {
        const video = document.createElement("video");
        video.controls = true;
        video.autoplay = true;
        video.muted = true;
        video.defaultMuted = true; // sets the `muted` attribute too, which some browsers check for autoplay
        video.playsInline = true;
        video.loop = true;
        video.preload = "metadata";
        video.draggable = false;
        return video;
    }

    #releaseVideo(video) {
        video.pause();
        video.removeAttribute("src");
        video.load();
    }

    // Stable key for caching a piece of art's resolved path
    #artKey(art) {
        return art?.id ?? art?.art_name;
    }

    // Resolves to the working path for art `index` (or null).
    // If art_name already has an extension it is used as is; otherwise the extensions that match
    // art_type are tried in order and the first one that loads is cached.
    #resolveArt(index) {
        const art = this.characterArtArr[index];
        if (!art) return Promise.resolve(null);

        const base = `${CharacterCard.ART_ROOT}/${this.characterKey}/${art.art_name}`;
        if (CharacterCard.#hasKnownExtension(art.art_name)) return Promise.resolve(base);

        const key = this.#artKey(art);
        if (this.#resolvedArt.has(key)) return Promise.resolve(this.#resolvedArt.get(key));
        if (this.#pendingArt.has(key)) return this.#pendingArt.get(key);

        const isVideo = art.art_type === "video";
        const extensions = isVideo ? CharacterCard.VIDEO_EXTENSIONS : CharacterCard.ART_EXTENSIONS;

        const probe = (async () => {
            for (const ext of extensions) {
                const path = `${base}.${ext}`;
                if (await CharacterCard.#canLoad(path, isVideo)) {
                    this.#resolvedArt.set(key, path);
                    return path;
                }
            }
            return null; // nothing matched
        })().finally(() => {
            this.#pendingArt.delete(key);
        });

        this.#pendingArt.set(key, probe);
        return probe;
    }

    // Loads art `index` into `img`. If the file is a video, `img` is swapped for `video`
    // (and swapped back if the next item is an image).
    #loadArt(img, index, video = this.#createVideo()) {
        const token = Symbol(); // ignore results from a superseded load on the same slot
        img.artToken = token;

        this.#resolveArt(index).then((path) => {
            if (img.artToken !== token) return;

            const current = video.parentNode ? video : img;
            if (!current.parentNode) return; // no longer on screen

            const isVideo = path !== null && CharacterCard.isVideoPath(path);
            const target = isVideo ? video : img;

            if (target !== current) {
                current.replaceWith(target);
                if (current === video) this.#releaseVideo(video);
            }

            if (path === null) {
                target.removeAttribute("src");
                return;
            }

            if (isVideo) {
                video.className = img.className;
                video.setAttribute("aria-label", img.alt);
            }

            if (target.getAttribute("src") !== path) target.setAttribute("src", path);
        });
    }

    // Reserves the art's space before it loads, so the card doesn't jump when the file arrives.
    // The ratio is set synchronously from the db row, never from the loaded file.
    #applyContainerRatio() {
        const art = this.characterArtArr[this.currentArtIndex];
        this.cardArtContainer.style.aspectRatio = CharacterCard.#ratioOf(art);
    }

    #renderArt() {
        const total = this.characterArtArr.length;
        const label = total > 1
            ? `${this.characterName} art ${this.currentArtIndex + 1} of ${total}`
            : `${this.characterName} art`;

        this.cardArt.alt = label;
        this.cardVideo.setAttribute("aria-label", label);

        this.#applyContainerRatio(); // before the load starts
        this.#loadArt(this.cardArt, this.currentArtIndex, this.cardVideo);
    }

    // Tap-free swipe detection: the art changes instantly on release, no drag or slide animation
    #setupSwipe() {
        const container = this.cardArtContainer;
        let startX = null;

        // Let the browser handle vertical scrolling; we handle horizontal swipes
        container.style.touchAction = "pan-y";
        container.style.userSelect = "none";
        this.cardArt.draggable = false; // stop the browser's native image drag ghost

        container.addEventListener("pointerdown", (e) => {
            if (this.#showingAll) return; // swiping is disabled while all art is shown
            if (this.characterArtArr.length < 2) return;
            if (e.pointerType === "mouse" && e.button !== 0) return;

            // Leave the bottom strip of a video to its native controls (seek bar, volume, etc.)
            if (this.cardVideo.parentNode) {
                const rect = this.cardVideo.getBoundingClientRect();
                if (e.clientY > rect.bottom - CharacterCard.VIDEO_CONTROLS_HEIGHT) return;
            }

            startX = e.clientX;
            container.setPointerCapture(e.pointerId);
        });

        const endSwipe = (e) => {
            if (startX === null) return;

            const deltaX = e.clientX - startX;
            startX = null;

            if (container.hasPointerCapture(e.pointerId)) {
                container.releasePointerCapture(e.pointerId);
            }

            // Only act on a real release, not a cancelled gesture
            if (e.type === "pointerup") {
                if (Math.abs(deltaX) > CharacterCard.SWIPE_THRESHOLD) {
                    // Swipe left -> next, swipe right -> previous
                    deltaX < 0 ? this.nextArt() : this.prevArt();
                } else if (Math.abs(deltaX) <= CharacterCard.TAP_TOLERANCE && this.cardVideo.parentNode) {
                    // A tap on a video toggles playback
                    this.cardVideo.paused ? this.cardVideo.play().catch(() => {}) : this.cardVideo.pause();
                }
            }
        };

        container.addEventListener("pointerup", endSwipe);
        container.addEventListener("pointercancel", endSwipe);
    }

    showArt(index) {
        const total = this.characterArtArr.length;
        if (total === 0 || this.#showingAll) return;

        // Wrap around in both directions
        this.currentArtIndex = ((index % total) + total) % total;
        this.#renderArt();
    }

    nextArt() {
        this.showArt(this.currentArtIndex + 1);
    }

    prevArt() {
        this.showArt(this.currentArtIndex - 1);
    }

    // Replaces the single image/video with every piece of art of the character
    showAllArt() {
        const total = this.characterArtArr.length;
        if (this.#showingAll || total === 0) return;

        this.#showingAll = true;
        this.#releaseVideo(this.cardVideo); // stop the single-view video if it was playing

        const items = this.characterArtArr.map((art, i) => {
            const wrap = document.createElement("div");
            wrap.classList.add("Character-Card-Art-Item-Wrap");
            wrap.style.aspectRatio = CharacterCard.#ratioOf(art); // each item reserves its own space

            const img = document.createElement("img");
            img.classList.add("Character-Card-Art-Item");
            img.alt = `${this.characterName} art ${i + 1} of ${total}`;
            img.draggable = false;

            wrap.append(img);
            this.#loadArt(img, i); // swaps itself for a <video> if the file is a video
            return wrap;
        });

        // The stack is taller than any single piece of art, so the container's own ratio must not apply
        this.cardArtContainer.style.aspectRatio = "";
        this.cardArtContainer.classList.add("Character-Card-Art-All");
        this.cardArtContainer.replaceChildren(...items);
        this.showAllBtn.textContent = CharacterCard.HIDE_ALL_TEXT;
    }

    // Goes back to a single item: always the first one
    hideAllArt() {
        if (!this.#showingAll) return;

        this.#showingAll = false;
        this.currentArtIndex = 0;

        // Stop any videos that were playing in the stack
        this.cardArtContainer.querySelectorAll("video").forEach((v) => this.#releaseVideo(v));

        this.cardArtContainer.classList.remove("Character-Card-Art-All");
        this.cardArtContainer.replaceChildren(this.cardArt);
        this.#renderArt(); // also restores the container's aspect ratio
        this.showAllBtn.textContent = CharacterCard.SHOW_ALL_TEXT;
    }

    toggleAllArt() {
        this.#showingAll ? this.hideAllArt() : this.showAllArt();
    }

    get isShowingAllArt() {
        return this.#showingAll;
    }

    #getPreviewText() {
        const hasText = typeof this.characterDescription === "string" && this.characterDescription.trim() !== "";
        const text = hasText ? this.characterDescription : CharacterCard.DEFAULT_DESCRIPTION;
        const limit = CharacterCard.DESCRIPTION_PREVIEW_WORDS;

        // Find where the last allowed word ends (keeps original spacing and line breaks)
        const wordRegex = /\S+/g;
        let count = 0;
        let match;
        let endIndex = -1;

        while ((match = wordRegex.exec(text)) !== null) {
            count++;
            if (count === limit) {
                endIndex = match.index + match[0].length;
                break;
            }
        }

        // Fewer words than the limit, or nothing but whitespace after the last allowed word: show everything
        if (endIndex === -1 || text.slice(endIndex).trim() === "") return text;

        return text.slice(0, endIndex) + "...";
    }

    #renderDescription() {
        this.descriptionTextarea.value = this.#getPreviewText();
        this.#autoResize();
    }

    // Fits the textarea height to its content
    #autoResize() {
        const el = this.descriptionTextarea;
        el.style.height = "auto";

        // scrollHeight excludes borders; add them back since box-sizing is border-box
        const borders = el.offsetHeight - el.clientHeight;
        el.style.height = `${el.scrollHeight + borders}px`;
    }

    // Re-fit when the textarea's width changes (text wraps differently)
    #observeWidth() {
        let lastWidth = 0;

        this.resizeObserver = new ResizeObserver(() => {
            const width = this.descriptionTextarea.clientWidth;
            if (width !== lastWidth) {
                lastWidth = width;
                this.#autoResize();
            }
        });

        this.resizeObserver.observe(this.descriptionTextarea);
    }

    #renderTags() {
        this.cardTagsContainer.replaceChildren();

        this.characterTags.forEach((tag) => {
            const tagContainer = document.createElement("div");
            const tagText = document.createElement("p");

            tagText.textContent = tag;
            tagContainer.append(tagText);
            this.cardTagsContainer.append(tagContainer);
        });
    }

    // Adds genderMaleLabel / genderFemaleLabel to the card, removing any previous gender class
    #applyGenderClass() {
        const classes = Object.values(CharacterCard.GENDER_CLASSES);
        this.cardContainer.classList.remove(...classes);

        const gender = String(this.characterGender ?? "").trim().toLowerCase();
        const gendered = CharacterCard.GENDER_CLASSES[gender];
        if (gendered) this.cardContainer.classList.add(gendered);
    }

    setGender(gender) {
        this.characterGender = gender;
        this.#applyGenderClass();
    }

    #resolveView(view) {
        return typeof view === "string" ? document.getElementById(view) : view;
    }

    setDescription(description) {
        this.characterDescription = description;
        this.#renderDescription();
    }

    addTag(tag) {
        this.characterTags.push(tag);
        this.#renderTags();
    }

    removeTag(tag) {
        this.characterTags = this.characterTags.filter((t) => t !== tag);
        this.#renderTags();
    }

    // Appends to the given parent, or to characterView if none is passed
    render(parent = this.characterView) {
        const target = this.#resolveView(parent);
        if (target) {
            target.append(this.cardContainer);
            this.#autoResize(); // measure now that it's in the DOM
        }
        return this.cardContainer;
    }

    #setCurrentCharacterProfile() {
        localStorage.setItem("currentCharacter", this.characterId)
    }
}