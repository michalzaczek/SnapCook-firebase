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

// Middleware for checking premium status
const checkIfPremium = async (
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): Promise<void> => {
  const userId = req.user?.uid;

  if (!userId) {
    res.status(403).send("User ID not found.");
    return;
  }

  try {
    const db = admin.firestore();
    const subscriptionsRef = db
      .collection("users")
      .doc(userId)
      .collection("subscriptions");
    const querySnapshot = await subscriptionsRef
      .where("status", "==", "active")
      .get();

    const isPremium = !querySnapshot.empty;
    if (isPremium) {
      next(); // User is premium, proceed to the next middleware or request handler
    } else {
      res.status(403).send("Access denied. User is not a premium subscriber.");
    }
  } catch (error) {
    console.error("Error checking premium status:", error);
    res.status(500).send("Internal Server Error");
  }
};

async function handleOpenAIRequest(
  req: express.Request,
  res: express.Response,
  userInput:
    | string
    | Array<{ type: string; text?: string; image_url?: { url: string } }>,
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

    let userMessages: Array<{ role: string; content: any }>;

    if (typeof userInput === "string") {
      userMessages = [
        { role: "user", content: [{ type: "text", text: userInput }] },
      ];
    } else {
      userMessages = [
        {
          role: "user",
          content: userInput,
        },
      ];
    }

    const payload = {
      model: model,
      messages: [{ role: "system", content: systemMessage }, ...userMessages],
      max_tokens: maxTokens,
      // format: "json_object",
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
    res
      .status(500)
      .send("Error while communicating with external server: " + error);
  }
}

// ------------ getIngredients ------------ //
app.post("/getIngredients", authenticate, checkIfPremium, async (req, res) => {
  const image = req.body.image;

  const userInputs = [
    { type: "text", text: "What’s in this image?" },
    {
      type: "image_url",
      image_url: { url: `data:image/jpeg;base64,${image}` },
    },
  ];

  handleOpenAIRequest(req, res, userInputs, "gpt-4-vision-preview", 300);
});

//---------------- getRecipesList ----------------//
app.get("/getRecipesList", authenticate, checkIfPremium, async (req, res) => {
  const ingredients = req.query.ingredients;

  if (typeof ingredients !== "string" || ingredients.trim() === "") {
    res.status(400).send("No valid ingredients provided");
    return;
  }

  handleOpenAIRequest(req, res, ingredients);
});

// --------------- getRecipeDetails ------------------- //
app.get("/getRecipeDetails", authenticate, checkIfPremium, async (req, res) => {
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
