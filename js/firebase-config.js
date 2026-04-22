import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import { getDatabase, ref } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-database.js";

const app = initializeApp({
  databaseURL: "https://deckscan-bda7b-default-rtdb.firebaseio.com",
});

export const db = getDatabase(app);
export const dbRef = ref(db, 'deckscan');
