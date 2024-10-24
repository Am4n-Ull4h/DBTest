import Stripe from 'stripe';
import * as admin from 'firebase-admin';
import { ref, set, get } from "firebase/database"; // Import necessary Firebase functions

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const endpointSecret = process.env.STRIPE_WEBHOOK_SECRET;

// Ensure Firebase Admin is initialized
try {
  if (!admin.apps.length) {
    // const serviceAccount = require(
    // );
    
    admin.initializeApp({
      credential: admin.credential.cert({
        "type": process.env.FIREBASE_PROJECT_TYPE,
        "project_id": process.env.FIREBASE_PROJECT_ID,
        "private_key_id":  process.env.FIREBASE_PRIVATE_KEY_ID,
        "private_key":  process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        "client_email":  process.env.FIREBASE_CLIENT_EMAIL,
        "client_id":  process.env.FIREBASE_CLIENT_ID,
        "auth_uri":  process.env.FIREBASE_AUTH_URI,
        "token_uri":  process.env.FIREBASE_TOKEN_URI,
        "auth_provider_x509_cert_url":  process.env.FIREBASE_AUTH_PROVIDER,
        "client_x509_cert_url":  process.env.FIREBASE_CERT_URL,
        "universe_domain":  process.env.FIREBASE_UNIVERSE_DOMAIN
      }),
      databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL, // Your Firebase database URL
    });
  }
} catch (error) {
  console.error('Error initializing Firebase Admin:', error);
}

const db = admin.database(); // Use admin.database() to get the database instance

// Function to get raw body from the request
async function getRawBody(req) {
  const buffer = await req.arrayBuffer(); // Get the raw body as an ArrayBuffer
  return Buffer.from(buffer); // Convert it to a Buffer
}

// Handle POST request for the webhook
export async function POST(req) {
  const buf = await getRawBody(req);
  const sig = req.headers.get('stripe-signature');

  let event;

  // Verify the event
  try {
    event = stripe.webhooks.constructEvent(buf.toString(), sig, endpointSecret);
  } catch (err) {
    return new Response(`Webhook error: ${err.message}`, { status: 400 });
  }

  // Handle the checkout.session.completed event
  if (event.type === 'checkout.session.completed') {
    const session = event.data.object;
    const amount = session.amount_total; // Amount in cents
    const uid = session.metadata.uid; // User ID from metadata

    if (!uid) {
      return new Response('UID not found', { status: 400 });
    }

    const dataRef = ref(db, `users/${uid}/tokens`);
    
    // Get the current tokens for the user
    const snapshot = await get(dataRef);
    const currentTokens = snapshot.exists() ? snapshot.val() : 0;

    let creditsToAdd = 0;

    // Determine how many credits to add based on the amount
    if (amount === 3900) {
      creditsToAdd = 2500;
    } else if (amount === 9500) {
      creditsToAdd = 6500;
    } else if (amount === 29000) {
      creditsToAdd = 20000;
    }

    // Check if the session has already been processed
    const sessionRef = ref(db, `sessions/${session.id}`);
    const sessionSnapshot = await get(sessionRef);

    if (!sessionSnapshot.exists()) {
      // Add the session as processed
      await set(sessionRef, { processed: true });

      // Update the user's tokens directly
      const newTokenCount = currentTokens + creditsToAdd;
      await set(dataRef, newTokenCount);

      console.log(`Updated tokens for user ${uid}: ${newTokenCount}`);
    } else {
      console.log('Session already processed');
      return new Response('Session already processed', { status: 200 });
    }
  }

  // Respond with a 200 status to acknowledge receipt of the event
  return new Response(JSON.stringify({ received: true }), { status: 200 });
}

// Handle other HTTP methods if needed (optional)
export async function GET(req) {
  return new Response('Method Not Allowed', { status: 405 });
}
