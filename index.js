const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const port = process.env.PORT || 5000;

const { ObjectId } = require("mongodb");

//middleware
app.use(cors());
app.use(express.json());

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
    await client.connect();

    const userCollection = client.db("mcmsDB").collection("users");
    const campCollection = client.db("mcmsDB").collection("camps");

    // user related api
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
      const result = await campCollection.insertOne(camp);
      res.send(result);
    });
    app.get("/camp", async (req, res) => {
      const result = await campCollection.find().toArray();
      res.send(result);
    });

    // Send a ping to confirm a successful connection
    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
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
