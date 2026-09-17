import { initializeApp } from "firebase/app";
import { getAuth, createUserWithEmailAndPassword } from "firebase/auth";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

const config = {
  apiKey: firebaseConfig.apiKey,
  authDomain: firebaseConfig.authDomain,
  projectId: firebaseConfig.projectId,
  appId: firebaseConfig.appId
};

async function run() {
  console.log("Initializing Firebase...");
  const app = initializeApp(config);
  const auth = getAuth(app);

  console.log("Attempting to register shwayat.mustafa@gmail.com...");
  try {
    const cred = await createUserWithEmailAndPassword(auth, "shwayat.mustafa@gmail.com", "123456");
    console.log("Successfully registered admin user! UID:", cred.user.uid);
  } catch (err: any) {
    console.log("Registration failed:", err.code, err.message);
  }
  process.exit(0);
}

run().catch(console.error);
