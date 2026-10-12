import { hashPassword } from './auth'
import { createUser, loginUser, initDB, addCharacter, countAndInfoOfArt, addArt, getCharacters, getCharacter } from './db'
import { setSession, getSession, clearSession } from './session'
import { CharacterCard } from "./applicationClasses/characterCard.js"
import CharacterArtInput from "./CharacterArtInput.js";
import { showCharacterProfile } from './characterProfile.js';

const signUpPage = document.getElementById("signUpPage");
const signInPage = document.getElementById("signInPage");
const homePage = document.getElementById("homePage");
const addPage = document.getElementById("addPage");
const profilePage = document.getElementById("profilePage");

const userMenu = document.getElementById("userMenu");

const goToSignInPageBtn = document.getElementById("goToSignInPageBtn");
const goToSignUpPageBtn = document.getElementById("goToSignUpPageBtn");
const signInBtn = document.getElementById("signInBtn");
const signUpBtn = document.getElementById("signUpBtn");
const suiteRefreshBtn = document.getElementById("suiteRefreshBtn");
const menuSignOutBtn = document.getElementById("menuSignOutBtn");
const openUserMenuBtn = document.getElementById("openUserMenuBtn");
const goToAddPageBtn = document.getElementById("goToAddPageBtn");
const addPageBackBtn = document.getElementById("addPageBackBtn");
const selectMaleBtn = document.getElementById("selectMaleBtn");
const selectFemaleBtn = document.getElementById("selectFemaleBtn");
const saveCharacterBtn = document.getElementById("saveCharacterBtn");
const cancelCharacterBtn = document.getElementById("cancelCharacterBtn");
const allCharactersBtn = document.getElementById("allCharactersBtn");
const maleCharactersBtn = document.getElementById("maleCharactersBtn");
const femaleCharactersBtn = document.getElementById("femaleCharactersBtn");
const profilePageBackBtn = document.getElementById("profilePageBackBtn");

const usernameInput = document.getElementById("usernameInput");
const passwordInput = document.getElementById("passwordInput");
const setUsernameInput = document.getElementById("setUsernameInput");
const setPasswordInput = document.getElementById("setPasswordInput");
const verifyPasswordInput = document.getElementById("verifyPasswordInput");
const characterNameInput = document.getElementById("characterNameInput");
const characterDescriptionInput = document.getElementById("characterDescriptionInput");

const art = CharacterArtInput("characterArtInput", "artPreviewsContainer");

const MESSAGES = {
    emptyFields: "make sure all fields are complete",
    differentPasswords: "make sure passwords are the same",
    invalidPassword: "make sure password is valid",
    accountCreationSuccess: "account successfully created",
    accountCreationFailed: "account creation unsuccessfull",
    invalidCredentials: "invalid credentials, try again",
    successfulSignIn: "signing you in...",
    addCharacterSuccess: "successfully added character",
    addCharacterUnsuccess: "could not add character",
}

let isMenuOpen = false;
let selectedGender = null;

const MAX_FILE_SIZE = 250 * 1024 * 1024;

const MIME_TO_EXT = {
    "image/jpeg": "jpg", "image/png": "png", "image/gif": "gif", "image/webp": "webp",
    "image/heic": "heic", "image/heif": "heif", "image/avif": "avif", "image/svg+xml": "svg",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm", "video/x-m4v": "m4v"
};

// "Dave Maxwell" -> "DaveMaxwell"
function formatArtBaseName(name) {
    return name
        .trim()
        .replace(/\b\w/g, c => c.toUpperCase())
        .replace(/[^\p{L}\p{N}]/gu, "") || "Character";
}

// extension from the original file name, falling back to the MIME type
function getExtension(info) {
    const dot = info.name.lastIndexOf(".");
    if (dot > -1) {
        const ext = info.name.slice(dot + 1).toLowerCase().replace(/[^a-z0-9]/g, "");
        if (ext) return ext;
    }
    return MIME_TO_EXT[info.mimeType] || "bin";
}

// ---------- Helpers ----------

/** Unwraps an { ok, error, ...data } response or throws. */
function unwrap(res, message) {
    if (!res.ok) throw new Error(message ? `${message}: ${res.error}` : res.error);
    return res;
}

/** Wraps an async action so it can't run twice at once and always re-enables the button. */
function withButtonLock(button, action) {
    return async (...args) => {
        if (button.disabled) return;
        button.disabled = true;
        try {
            return await action(...args);
        } finally {
            button.disabled = false;
        }
    };
}

// ---------- Form ----------

class ValidationError extends Error {}

function readCharacterForm() {
    const fullname = characterNameInput.value.trim();
    if (!fullname || selectedGender === null) {
        throw new ValidationError("Please enter a name and choose a gender.");
    }
    return {
        fullname,
        description: characterDescriptionInput.value.trim(),
        gender: selectedGender
    };
}

// ---------- Data layer ----------

async function createCharacter(userId, character) {
    const res = unwrap(await addCharacter(userId, character));
    return res.characterId;
}

async function saveCharacterArt(userId, characterId, characterName, artFiles) {
    if (artFiles.length === 0) return [];

    const baseName = formatArtBaseName(characterName);
    const { artCount } = unwrap(await countAndInfoOfArt(userId, characterId));

    const saved = [];
    // Sequential on purpose: keeps numbering deterministic and stops at first failure.
    for (const [i, info] of artFiles.entries()) {
        const artName = `${baseName}${artCount + 1 + i}.${getExtension(info)}`; // e.g. DaveMaxwell1.png

        const res = unwrap(
            await addArt(userId, {
                characterId,
                artName,
                width: info.width,
                height: info.height,
                artType: info.mediaType,
                artPurpose: "character_art"
            }),
            `Failed to save "${info.name}"`
        );
        saved.push(res.art);
    }
    return saved;
}

/** Full save workflow: UI-agnostic, so it's reusable and testable. */
async function saveCharacterWithArt({ character, artFiles }) {
    const userId = await getUserId();
    const characterId = await createCharacter(userId, character);
    const art = await saveCharacterArt(userId, characterId, character.fullname, artFiles);
    return { characterId, art };
}

// ---------- UI wiring ----------

async function handleSaveCharacter() {
    try {
        const character = readCharacterForm();
        const artFiles = await art.getFilesInfo();

        await saveCharacterWithArt({ character, artFiles });

        art.clear();
        clearAddPageInputs();
    } catch (err) {
        if (err instanceof ValidationError) {
            alert(err.message);
            return;
        }
        console.error(err);
        alert("Couldn't save the character. Please try again.");
    }
}

saveCharacterBtn.addEventListener("click", withButtonLock(saveCharacterBtn, handleSaveCharacter));

cancelCharacterBtn.addEventListener("click", () => {
    clearAddPageInputs()
})

selectMaleBtn.addEventListener("click", () => {
    selectedGender = "male";
    selectMaleBtn.classList.add("addSelectedBtnStyle");
    selectFemaleBtn.classList.remove("addSelectedBtnStyle");
})

selectFemaleBtn.addEventListener("click", () => {
    selectedGender = "female";
    selectFemaleBtn.classList.add("addSelectedBtnStyle");
    selectMaleBtn.classList.remove("addSelectedBtnStyle");
})

goToSignInPageBtn.addEventListener("click", async () => {
    clearSignInSignUpInputs()
    setCurrentPage("signInPage");
    await showCurrentPage();
})

goToSignUpPageBtn.addEventListener("click", async () => {
    clearSignInSignUpInputs();
    setCurrentPage("signUpPage");
    await showCurrentPage();
})

goToAddPageBtn.addEventListener("click", async () => {
    setCurrentPage("addPage");
    await showCurrentPage();
})

addPageBackBtn.addEventListener("click", async () => {
    setCurrentPage("homePage");
    clearAddPageInputs()
    await showCurrentPage();
});

profilePageBackBtn.addEventListener("click", async () => {
    setCurrentPage("homePage");
    await showCurrentPage();
});

function clearSignInSignUpInputs() {
    usernameInput.value = "";
    passwordInput.value = "";
    setUsernameInput.value = "";
    setPasswordInput.value = "";
    verifyPasswordInput.value = "";
}

function clearAddPageInputs() {
    characterNameInput.value = "";
    characterDescriptionInput.value = "";
    selectedGender = null;
    selectMaleBtn.classList.remove("addSelectedBtnStyle")
    selectFemaleBtn.classList.remove("addSelectedBtnStyle")
    art.clear();
}

allCharactersBtn.addEventListener("click", () => {
    document.querySelectorAll(".genderMaleLabel").forEach(card => {
        card.classList.remove("Hide");
    });

    document.querySelectorAll(".genderFemaleLabel").forEach(card => {
        card.classList.remove("Hide");
    });
});

maleCharactersBtn.addEventListener("click", () => {
    document.querySelectorAll(".genderMaleLabel").forEach(card => {
        card.classList.remove("Hide");
    });

    document.querySelectorAll(".genderFemaleLabel").forEach(card => {
        card.classList.add("Hide");
    });
})

femaleCharactersBtn.addEventListener("click", () => {
    document.querySelectorAll(".genderMaleLabel").forEach(card => {
        card.classList.add("Hide");
    });

    document.querySelectorAll(".genderFemaleLabel").forEach(card => {
        card.classList.remove("Hide");
    });
})

signInBtn.addEventListener("click", async () => {
    if (usernameInput.value === "" || passwordInput.value === "") {
        showMessageBox("messageBoxSignInPage", MESSAGES["emptyFields"])
    } else {
        const res = await loginUser(usernameInput.value, passwordInput.value);
        if (res.ok) {
            await setSession(res.user);
            clearSignInSignUpInputs();
            showMessageBox("messageBoxSignInPage", MESSAGES["successfulSignIn"])
            setCurrentPage("homePage");
            setTimeout(showCurrentPage, 2000)
        } else {
            showMessageBox("messageBoxSignInPage", MESSAGES["invalidCredentials"])
        }
    }
})

signUpBtn.addEventListener("click", async () => {
    if (setUsernameInput.value.trim() === "" || setPasswordInput.value.trim() === "" || verifyPasswordInput.value.trim() === "") {
        showMessageBox("messageBoxSignUpPage", MESSAGES["emptyFields"])
    } else if (setPasswordInput.value.trim() !== verifyPasswordInput.value.trim()) {
        showMessageBox("messageBoxSignUpPage", MESSAGES["differentPasswords"])
    } else {
        const checkPassword = isPasswordValid(setPasswordInput.value.trim());
        if (checkPassword) {
            const res = await createUser(setUsernameInput.value.trim(), await hashPassword(setPasswordInput.value.trim()))
            console.log(res)
            if (res.ok) {
                clearSignInSignUpInputs();
                showMessageBox("messageBoxSignUpPage", MESSAGES["accountCreationSuccess"])
            } else {
                showMessageBox("messageBoxSignUpPage", MESSAGES["accountCreationFailed"])
            }
        } else {
            showMessageBox("messageBoxSignUpPage", MESSAGES["invalidPassword"])
        }
    }
})

menuSignOutBtn.addEventListener("click", async () => {
    await clearSession();
    setCurrentPage("signInPage");
    await showCurrentPage();
})

suiteRefreshBtn.addEventListener("click", () => {
    location.reload();
})

openUserMenuBtn.addEventListener("click", () => {
    isMenuOpen = !isMenuOpen
    if (isMenuOpen) {
        userMenu.classList.remove("Hide");
    } else {
        userMenu.classList.add("Hide");
    }
})

function isPasswordValid(password) {
    const hasUppercase = /[A-Z]/.test(password);
    const hasLowercase = /[a-z]/.test(password);
    const hasNumber = /[0-9]/.test(password);
    const hasSpecial = /[!@#$%^&*()_+\-=\[\]{};':"\\|,.<>/?]/.test(password);
    return password.length >= 10 &&
           hasUppercase &&
           hasLowercase &&
           hasNumber &&
           hasSpecial;
}

function showMessageBox(boxId, boxMessage) {
    const messageBox = document.getElementById(boxId);
    const message = document.createElement("p");
    messageBox.innerHTML = ""
    message.textContent = boxMessage;
    messageBox.appendChild(message);
    messageBox.classList.remove("Hide");
    setTimeout(() => {
        hideMessageBox(boxId)
    }, 2000);
}

const renderedCards = [];

async function getUserCharacters() {
    const userId = await getUserId()
    const characters = await getCharacters(userId)

    const objPath = characters.userCharacters.values

    for (const character of objPath) {
        console.log(character)
        if (renderedCards.includes(character.id)) continue;
        const artCountAndInfo = await countAndInfoOfArt(userId, character.id)
        const characterCard = new CharacterCard(character.id, character.fullname, artCountAndInfo.artInfo, character.gender, character.description, JSON.parse(character.tags), "allCharactersView")
        characterCard.render();
        renderedCards.push(character.id);
    }
}

function hideMessageBox(boxId) {
    const messageBox = document.getElementById(boxId);
    messageBox.innerHTML = "";
    messageBox.classList.add("Hide");
}

function createCharacterViewPlaceholder(view) {
    const PLACEHOLDERS = {
        all: "NO CHARACTERS YET",
        male: "NO MALE CHARACTERS YET",
        female: "NO FEMALE CHARACTERS YET"
    }
    const placeholderContainer = document.createElement("div");
    const placeholder = document.createElement("p");
    placeholder.textContent === PLACEHOLDERS[view];

    placeholderContainer.appendChild(placeholder)
}

async function showUsername() {
    const username = await getUsername();
    openUserMenuBtn.textContent = username
}

async function getUsername() {
    const session = await getSession();
    return session.username
}

export async function getUserId() {
    const session = await getSession();
    return session.id
}

export function setCurrentPage(page) {
    localStorage.setItem("currentPage", page)
}

function getCurrentPage() {
    const currentPage = localStorage.getItem("currentPage");
    if (currentPage) {
        return currentPage
    }
}

function hideAllPages() {
    const pages = [signUpPage, signInPage, homePage, addPage, profilePage]
    pages.forEach(page => {
        page.classList.add("Hide");
    });
}

function hideAllMenus() {
    const menus = [userMenu]
    menus.forEach(menu => {
        menu.classList.add("Hide");
    })
}

export async function showCurrentPage() {
    const currentPage = getCurrentPage();

    hideAllPages();
    hideAllMenus();

    if (currentPage === "signUpPage") {
        signUpPage.classList.remove("Hide");
    } else if (currentPage === "signInPage") {
        signInPage.classList.remove("Hide");
    } else if (currentPage === "homePage") {
        homePage.classList.remove("Hide");
        await showUsername();
        await getUserCharacters();
    } else if (currentPage === "addPage") {
        addPage.classList.remove("Hide");
        art.clear();
    } else if (currentPage === "profilePage") {
        profilePage.classList.remove("Hide")
        await showCharacterProfile();
    } else {
        signInPage.classList.remove("Hide");
    }
}

async function init() {
    await initDB();
    const currentPage = getCurrentPage();
    const session = await getSession();
    if (session) setCurrentPage(currentPage);
    await showCurrentPage();
}

await init().catch(console.error);