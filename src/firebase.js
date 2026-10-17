import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// Es el mismo proyecto que usa el sistema de turnos.
// ⚠️ Reemplazá SOLO el apiKey: copialo del firebaseConfig que ya tenés en admin.html.
const firebaseConfig = {
  apiKey: "AIzaSyCwB3Tpqe9EAPctSh4aB-aqf6xSUhm0Twc",
  authDomain: "fusion-peluqueria-e62f1.firebaseapp.com",
  projectId: "fusion-peluqueria-e62f1",
  storageBucket: "fusion-peluqueria-e62f1.firebasestorage.app",
  messagingSenderId: "1091187068496",
  appId: "1:1091187068496:web:f0c0f0dca735960a0ccb55",
};

export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);