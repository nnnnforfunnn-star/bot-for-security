import { Blob, FormData } from "formdata-node"; // or check if we can use native ones
// Let's use native globals since we are in Node 18+

async function test() {
  try {
    console.log("Testing upload to Catbox...");
    
    // Create dummy 100 byte buffer representing a small jpeg
    const buffer = Buffer.alloc(100);
    const blob = new globalThis.Blob([buffer], { type: "image/jpeg" });
    
    const formData = new globalThis.FormData();
    formData.append("reqtype", "fileupload");
    formData.append("fileToUpload", blob, "test.jpg");

    console.log("Sending request to Catbox...");
    const response = await fetch("https://catbox.moe/user/api.php", {
      method: "POST",
      body: formData
    });

    const text = await response.text();
    console.log("Catbox response status:", response.status);
    console.log("Catbox response text:", text);
  } catch (err) {
    console.error("Error during upload:", err);
  }
}

test();
