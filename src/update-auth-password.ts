import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import firebaseConfig from "../firebase-applet-config.json" assert { type: "json" };

async function run() {
  console.log("Initializing Firebase Admin Auth...");
  const app = initializeApp({
    projectId: firebaseConfig.projectId
  });

  const auth = getAuth(app);
  console.log("Locating user shwayat.mustafa@gmail.com...");
  try {
    const user = await auth.getUserByEmail("shwayat.mustafa@gmail.com");
    console.log(`Found user: ${user.uid}. Updating password...`);
    await auth.updateUser(user.uid, {
      password: "123456"
    });
    console.log("Password updated successfully!");
  } catch (err: any) {
    if (err.code === "auth/user-not-found") {
      console.log("User not found. Creating user shwayat.mustafa@gmail.com...");
      const user = await auth.createUser({
        email: "shwayat.mustafa@gmail.com",
        password: "123456",
        emailVerified: true
      });
      console.log(`Created user successfully with UID: ${user.uid}`);
    } else {
      console.error("Error:", err);
    }
  }
}

run().catch(console.error);
