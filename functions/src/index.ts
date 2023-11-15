import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as cors from "cors";
import axios from "axios";

const corsHandler = cors({ origin: true });

export const getIngredients = functions.https.onRequest((request, response) => {
  corsHandler(request, response, async () => {
    if (request.method !== "POST") {
      response.status(405).send("Method Not Allowed");
      return;
    }

    // Verify Firebase ID Token
    const idToken = request.get("Authorization")?.split("Bearer ")[1];
    if (!idToken) {
      response.status(403).send("Unauthorized");
      return;
    }

    try {
      // Verifying the ID token
      await admin.auth().verifyIdToken(idToken);

      const image = request.body.image;

      const systemMessage = `Specialize in identifying food ingredients in photos for culinary use. List ingredients in singular form (e.g., 'carrot' not 'carrots'), use general names avoiding brands (e.g., 'ketchup' not 'Heinz Ketchup'), packaging forms (e.g., 'pickle' not 'jarred pickles'), or complex names (e.g., 'chocolate' not 'chocolate spread'). 
    Exclude non-food items (e.g., 'paper', 'plastic') and overly generic items (e.g., 'sauce', 'salad dressing', 'condiment', 'spice'). Present results in JSON format.
    Example: If three carrots are recognized with and one potato, output:
    {
      "ingredients": ["carrot", "potato"],
    }
    Return this and nothing else.`;
      const payload = {
        model: "gpt-4-vision-preview",
        messages: [
          { role: "system", content: systemMessage },
          {
            role: "user",
            content: [
              { type: "text", text: "What’s in this image?" },
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${image}` },
              },
            ],
          },
        ],
        max_tokens: 300,
      };

      const api_key = functions.config().openai.apikey;

      const headers = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${api_key}`,
      };

      try {
        const openaiResponse = await axios.post(
          "https://api.openai.com/v1/chat/completions",
          payload,
          { headers }
        );
        response.send(openaiResponse.data);
      } catch (error) {
        response.status(500).send(error);
      }
    } catch (error) {
      response.status(403).send("Unauthorized");
    }
  });
});
