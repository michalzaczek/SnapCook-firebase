import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as express from "express";
import * as cors from "cors";
import * as bodyParser from "body-parser";
import * as fs from "fs/promises";
import axios from "axios";

// firebase user interface
declare global {
  namespace Express {
    interface Request {
      user?: admin.auth.DecodedIdToken;
    }
  }
}

admin.initializeApp();

const openai_apikey =
  functions.config().openai?.apikey || process.env.OPENAI_LOCALKEY;

// const spoon_apikey = functions.config().spoonacular?.key || process.env.SPOON_LOCALKEY;

const app = express();

// Middleware for CORS
app.use(cors({ origin: true }));
app.use(bodyParser.json());

// Middleware for authentication
const authenticate = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): Promise<void> => {
  const idToken = req.get("Authorization")?.split("Bearer ")[1];
  if (!idToken) {
    res.status(403).send("No token provided.");
    return;
  }

  try {
    const user = await admin.auth().verifyIdToken(idToken);
    req.user = user; // Add the user to the request object
    next();
  } catch (error) {
    res.status(500).send("Error verifying token.");
  }
};

async function handleOpenAIRequest(
  req: express.Request,
  res: express.Response,
  userInput: string,
  model: string = "gpt-3.5-turbo",
  maxTokens: number = 1000
): Promise<void> {
  const systemMessageFolder = "./data/";

  try {
    const endpointName = req.route.path.substring(1);
    const systemMessage = await fs.readFile(
      systemMessageFolder + endpointName + ".txt",
      "utf8"
    );

    const payload = {
      model: model,
      messages: [
        { role: "system", content: systemMessage },
        {
          role: "user",
          content: [{ type: "text", text: userInput }],
        },
      ],
      max_tokens: maxTokens,
    };

    const headers = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${openai_apikey}`,
    };

    const openaiResponse = await axios.post(
      "https://api.openai.com/v1/chat/completions",
      payload,
      { headers }
    );
    res.json(JSON.parse(openaiResponse.data.choices[0].message.content));
  } catch (error) {
    res.status(500).send("Error while communicating with OpenAI: " + error);
  }
}

// ------------ getIngredients ------------ //
app.post("/getIngredients", authenticate, async (req, res) => {
  try {
    const image = req.body.image;

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
      res.send(openaiResponse.data);
    } catch (error) {
      res.status(500).send(error);
    }
  } catch (error) {
    res.status(500).send("An error occurred while processing the image.");
  }
});

//---------------- getRecipesList ----------------//
app.get("/getRecipesList", async (req, res) => {
  const ingredients = req.query.ingredients;

  if (typeof ingredients !== "string" || ingredients.trim() === "") {
    res.status(400).send("No valid ingredients provided");
    return;
  }

  handleOpenAIRequest(req, res, ingredients);
});

// --------------- getRecipeDetails ------------------- //
app.get("/getRecipeDetails", async (req, res) => {
  const { ingredients, title, category } = req.query;

  if (typeof ingredients !== "string" || ingredients.trim() === "") {
    res.status(400).send("No valid ingredients provided");
    return;
  }

  if (typeof title !== "string" || title.trim() === "") {
    res.status(400).send("No valid title provided");
    return;
  }

  if (typeof category !== "string" || category.trim() === "") {
    res.status(400).send("No valid category provided");
    return;
  }

  const userMessage = `title: ${title}, ingredients: ${ingredients}, category: ${category}`;

  handleOpenAIRequest(req, res, userMessage);
});

// Export the API to Firebase Functions
export const api = functions.https.onRequest(app);
