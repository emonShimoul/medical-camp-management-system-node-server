const express = require("express");
const cors = require("cors");
require("dotenv").config();

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());

app.use(express.json());

var jwt = require("jsonwebtoken");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

const { ObjectId } = require("mongodb");

const { MongoClient, ServerApiVersion } = require("mongodb");

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.pabg0.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});
async function run() {
  try {
    // Connect the client to the server	(optional starting in v4.7)
    // await client.connect();

    const userCollection = client.db("mcmsDB").collection("users");
    const campCollection = client.db("mcmsDB").collection("camps");
    const registeredCampsCollection = client
      .db("mcmsDB")
      .collection("registeredCamps");
    const paymentCollection = client.db("mcmsDB").collection("payments");
    const feedbackCollection = client.db("mcmsDB").collection("feedback");

    // jwt related api
    app.post("/jwt", async (req, res) => {
      const user = req.body;
      const token = jwt.sign(user, process.env.ACCESS_TOKEN_SECRET, {
        expiresIn: "1h",
      });
      res.send({ token });
    });

    // middlewares
    const verifyToken = (req, res, next) => {
      if (!req.headers.authorization) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = req.headers.authorization.split(" ")[1];
      jwt.verify(token, process.env.ACCESS_TOKEN_SECRET, (err, decoded) => {
        if (err) {
          return res.status(401).send({ message: "unauthorized access" });
        }
        req.decoded = decoded;
        next();
      });
      //   next();
    };

    // use verifyAdmin after verifyToken
    const verifyAdmin = async (req, res, next) => {
      const email = req.decoded.email;
      const query = { email: email };
      const user = await userCollection.findOne(query);
      const isAdmin = user?.role === "admin";
      if (!isAdmin) {
        return res.status(403).send({ message: "forbidden access" });
      }
      next();
    };

    // user related api
    app.get("/user/admin/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      if (email !== req.decoded.email) {
        return res.status(403).send({ message: "forbidden access" });
      }

      const query = { email: email };
      const user = await userCollection.findOne(query);
      let admin = false;
      if (user) {
        admin = user?.role === "admin";
      }
      res.send({ admin });
    });

    // Get user profile by email (admin only)
    app.get(
      "/user/profile/:email",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const email = req.params.email;
        const query = { email };
        const user = await userCollection.findOne(query);
        if (user) {
          res.send(user); // send full document
        } else {
          res.status(404).send({ message: "User not found" });
        }
      }
    );

    // Get participant profile by email
    app.get("/participant/profile/:email", verifyToken, async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);

      if (user) {
        res.send(user);
      } else {
        res.status(404).send({ message: "User not found" });
      }
    });

    app.put("/user/profile/:email", verifyToken, async (req, res) => {
      const email = req.params.email;

      // prevent users from updating others' profiles
      if (req.decoded.email !== email) {
        return res.status(403).send({ message: "Forbidden access" });
      }

      const { name, phone, image } = req.body;

      const filter = { email };
      const updateDoc = {
        $set: {
          name,
          phone,
          image,
        },
      };

      const result = await userCollection.updateOne(filter, updateDoc);
      res.send(result);
    });

    app.post("/users", async (req, res) => {
      const user = req.body;
      // insert email if user doesn't exists
      // you can do it in many ways
      const query = { email: user.email };
      const existingUser = await userCollection.findOne(query);
      if (existingUser) {
        return res.send({ message: "user already exists", insertedId: null });
      }
      const result = await userCollection.insertOne(user);
      res.send(result);
    });

    // camp related api
    app.post("/camp", async (req, res) => {
      const camp = req.body;

      // Initialize participantCount if not set
      if (camp.participantCount === undefined) {
        camp.participantCount = 0;
      }

      const result = await campCollection.insertOne(camp);
      res.send(result);
    });
    app.get("/camp", async (req, res) => {
      const result = await campCollection.find().toArray();
      res.send(result);
    });
    app.get("/camp/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await campCollection.findOne(query);
      res.send(result);
    });
    app.put("/camp/:id", verifyToken, verifyAdmin, async (req, res) => {
      const id = req.params.id;
      const updateData = req.body;

      const result = await campCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: updateData }
      );

      res.send(result);
    });
    app.delete(
      "/delete-camp/:campId",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const campId = req.params.campId;

        try {
          const result = await campCollection.deleteOne({
            _id: new ObjectId(campId),
          });
          res.send(result);
        } catch (err) {
          console.error("Error deleting camp:", err);
          res.status(500).send({ message: "Internal Server Error" });
        }
      }
    );

    // registeredCamps related api (for user)
    app.post("/registeredCamps", async (req, res) => {
      const registration = req.body;
      const { campId, userEmail } = registration;

      // Check if the user already registered for this camp
      const existing = await registeredCampsCollection.findOne({
        campId,
        userEmail,
      });

      if (existing) {
        return res
          .status(409)
          .send({ message: "You already registered for this camp." });
      }

      // Add default statuses before saving
      registration.confirmationStatus = "pending";
      registration.paymentStatus = "unpaid";

      const result = await registeredCampsCollection.insertOne(registration);

      if (result.insertedId) {
        // Increment participant count in the camp document
        await campCollection.updateOne(
          { _id: new ObjectId(campId) },
          { $inc: { participantCount: 1 } }
        );
      }

      res.send(result);
    });

    //  fetch by participant email
    app.get("/registeredCamps", async (req, res) => {
      const email = req.query.email;
      const result = await registeredCampsCollection
        .find({ userEmail: email })
        .toArray();
      res.send(result);
    });

    // registeredCamps related api (for admin)
    app.get(
      "/admin/registeredCamps",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const result = await registeredCampsCollection.find().toArray();
        res.send(result);
      }
    );

    app.patch(
      "/registeredCamps/confirm/:id",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const id = req.params.id;
        const result = await registeredCampsCollection.updateOne(
          { _id: new ObjectId(id) },
          { $set: { confirmationStatus: "confirmed" } }
        );
        res.send(result);
      }
    );

    app.delete("/registeredCamps/:id", verifyToken, async (req, res) => {
      const id = req.params.id;

      const registration = await registeredCampsCollection.findOne({
        _id: new ObjectId(id),
      });

      if (!registration) return res.status(404).send({ message: "Not found" });

      if (
        registration.paymentStatus === "paid" &&
        registration.confirmationStatus === "confirmed"
      ) {
        return res
          .status(400)
          .send({ message: "Cannot cancel a confirmed paid registration." });
      }

      const result = await registeredCampsCollection.deleteOne({
        _id: new ObjectId(id),
      });
      res.send(result);
    });

    // payment related apis
    app.post("/create-payment-intent", async (req, res) => {
      const { price } = req.body;

      if (!price || isNaN(price)) {
        return res.status(400).send({ error: "Invalid price provided" });
      }

      const amount = parseInt(price * 100);

      try {
        const paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: "usd",
          payment_method_types: ["card"],
        });

        res.send({
          clientSecret: paymentIntent.client_secret,
        });
      } catch (err) {
        console.error("Stripe error:", err);
        res.status(500).send({ error: "Failed to create payment intent" });
      }
    });

    app.post("/payments", async (req, res) => {
      const payment = req.body;
      const paymentResult = await paymentCollection.insertOne(payment);

      const filter = { _id: new ObjectId(payment.campId) };
      const updateDoc = {
        $set: {
          paymentStatus: "paid",
          transactionId: payment.transactionId, // optional but useful
        },
      };

      const updateResult = await registeredCampsCollection.updateOne(
        filter,
        updateDoc
      );

      res.send({ paymentResult, updateResult });
    });

    // feedback related api
    app.post("/feedback", async (req, res) => {
      const feedbackData = req.body;
      const result = await feedbackCollection.insertOne(feedbackData);
      res.send(result);
    });

    app.get("/feedback", async (req, res) => {
      const { email } = req.query;

      let query = {};
      if (email) {
        query = { userEmail: email };
      }

      try {
        const feedbacks = await feedbackCollection.find(query).toArray();
        res.send(feedbacks);
      } catch (err) {
        console.error("Error fetching feedback:", err);
        res.status(500).send({ message: "Internal Server Error" });
      }
    });

    // payment-history api
    app.get("/payment-history", async (req, res) => {
      const { email } = req.query;

      if (!email) {
        return res.status(400).send({ message: "Email is required" });
      }

      const result = await registeredCampsCollection
        .find({ userEmail: email })
        .toArray();

      res.send(result);
    });

    // Send a ping to confirm a successful connection
    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.get("/", (req, res) => {
  res.send("MCMS is running!!");
});

app.listen(port, () => {
  console.log(`MCMS is running on port ${port}`);
});
