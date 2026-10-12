import { getCharacter } from "./db";
import { getUserId } from "./main";

async function getCurrentCharacter() {
    const userId = await getUserId()
    const res = await getCharacter(userId, parseInt(localStorage.getItem("currentCharacter")));

    if (res.ok) {
        return res.userCharacter
    } else {
        return res.error
    }
}

export async function showCharacterProfile() {
    const character = await getCurrentCharacter();
    const characterProfileTitle = document.getElementById("characterProfileTitle");
    characterProfileTitle.textContent = character.fullname;
}