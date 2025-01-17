const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(
  cors({
    origin: ["http://localhost:5173"],
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

app.get("/", (req, res) => {
  res.send("mediCamp server is running...");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});

// JWT middleware
const verifyToken = (req, res, next) => {
  const token = req.cookies?.token;
  if (!token) {
    return res.status(401).json({ message: "No token, authorization denied" });
  }

  // Verify token
  jwt.verify(token, process.env.ACCESS_TOKEN, (error, decoded) => {
    if (error) {
      return res.status(401).json({ message: "Token verification failed" });
    }
    req.user = decoded;
    next();
  });
};

// MongoDB connection
const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.a8qb8.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;

// Create a MongoClient with a MongoClientOptions object to set the Stable API version
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  // jwt authentication
  app.post("/jwt", (req, res) => {
    const { email, name, picture } = req.body;
    const token = jwt.sign({ email, name, picture }, process.env.ACCESS_TOKEN, {
      expiresIn: "24h",
    });

    res
      .cookie("token", token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      })
      .send({ success: true });
  });

  app.post("/logout", (req, res) => {
    res
      .clearCookie("token", {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: process.env.NODE_ENV === "production" ? "none" : "strict",
      })
      .send({ success: true });
  });

  // user database
  const userCollection = client.db("mediCamp").collection("users");
  app.get("/users", async (req, res) => {
    const cursor = userCollection.find();
    const result = await cursor.toArray();
    res.send(result);
  });

  app.get("/user", async (req, res) => {
    const { email } = req.query;
    const user = await userCollection.findOne({ email });
    res.json({ exists: !!user });
  });

  app.get("/user-type", async (req, res) => {
    const { email } = req.query;
    const user = await userCollection.findOne({ email });
    if (user) {
      res.json(user);
    } else {
      res.status(404).send({ message: "User not found" });
    }
  });

  app.post("/users", async (req, res) => {
    const newUser = req.body;
    newUser.type = "participant";
    const result = await userCollection.insertOne(newUser);
    res.send(result);
  });

  // organizer update profile
  app.get("/user/:email", async (req, res) => {
    const email = req.params.email;
    const user = await userCollection.findOne({ email });
    if (user) {
      res.status(200).json(user);
    } else {
      res.status(404).json({ message: "User not found" });
    }
  });

  app.put("/user/:email", async (req, res) => {
    const { email } = req.params;
    const updatedData = req.body;
    const result = await userCollection.updateOne(
      { email },
      { $set: updatedData }
    );
    res.json(result);
  });

  // popular medical camps
  const campCollection = client.db("mediCamp").collection("camps");
  app.get("/popularcamps", async (req, res) => {
    const cursor = campCollection
      .find()
      .sort({ participantCount: -1 })
      .limit(6);
    const result = await cursor.toArray();
    res.send(result);
  });

  // all camps databases
  app.get("/camps", async (req, res) => {
    const cursor = campCollection.find();
    const result = await cursor.toArray();
    res.send(result);
  });

  app.get("/camps/:id", async (req, res) => {
    const { id } = req.params;
    const query = { _id: new ObjectId(id) };
    const result = await campCollection.findOne(query);
    res.send(result);
  });

  // add a camp
  app.post("/camps", async (req, res) => {
    const campData = req.body;
    const result = await campCollection.insertOne(campData);
    if (result.insertedId) {
      res.status(201).json({ insertedId: result.insertedId });
    } else {
      res.status(400).json({ message: "Failed to add camp" });
    }
  });

  // Delete Camp
  app.delete("/delete-camp/:campId", async (req, res) => {
    const { campId } = req.params;

    try {
      const result = await campCollection.deleteOne({
        _id: new ObjectId(campId),
      });

      if (result.deletedCount > 0) {
        res
          .status(200)
          .json({ message: "Camp deleted successfully", deleted: true });
      } else {
        res.status(404).json({ message: "Camp not found", deleted: false });
      }
    } catch (error) {
      console.error("Error deleting camp:", error);
      res
        .status(500)
        .json({ message: "Internal server error", deleted: false });
    }
  });

  // Update Camp
  app.put("/update-camp/:id", async (req, res) => {
    const { id } = req.params;
    const updatedData = req.body;

    delete updatedData._id;
    const result = await campCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: updatedData }
    );

    if (result.matchedCount === 1) {
      res.status(200).send({
        success: true,
        message: "Camp updated successfully",
        result,
      });
    } else {
      res.status(404).send({
        success: false,
        message: "Camp not found",
      });
    }
  });

  // joined participants database
  const participantCollection = client
    .db("mediCamp")
    .collection("joinedParticipants");

  // Add participant registration
  app.post("/joinedParticipant", async (req, res) => {
    const registrationData = req.body;
    const result = await participantCollection.insertOne(registrationData);
    res.status(201).send({
      success: true,
      message: "Participant registered successfully",
      result,
    });
  });

  // Get participant registrations
  app.get("/participants", async (req, res) => {
    const cursor = participantCollection.find();
    const result = await cursor.toArray();
    res.send(result);
  });

  // Delete participant
  app.delete("/cancel-registration/:id", async (req, res) => {
    const { id } = req.params;
    const result = await participantCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount > 0) {
      res.send({
        success: true,
        message: "Participant deleted successfully",
      });
    } else {
      res.status(404).send({
        success: false,
        message: "Participant not found",
      });
    }
  });

  // Update participant pending status
  app.put("/confirm-registration/:id", async (req, res) => {
    const { id } = req.params;
    const result = await participantCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { confirmationStatus: "Confirmed" } }
    );
    if (result.matchedCount === 1) {
      res.status(200).send({
        success: true,
        message: "Participant confirmed successfully",
      });
    } else {
      res.status(404).send({
        success: false,
        message: "Participant not found",
      });
    }
  });

  // Increment participant count
  app.patch("/camps/:id/increment", async (req, res) => {
    const { id } = req.params;

    const result = await campCollection.updateOne(
      { _id: new ObjectId(id) },
      { $inc: { participantCount: 1 } }
    );

    if (result.modifiedCount === 1) {
      res.send({ success: true, message: "Participant count incremented" });
    } else {
      res.status(404).send({ success: false, message: "Camp not found" });
    }
  });

  // Participant's Analytics
  // Fetch registered camps for a participant
  app.get("/analytics/:email", async (req, res) => {
    const { email } = req.params;
    if (!email) {
        return res.status(400).send({ success: false, message: "Email is required." });
    }

    try {
      const participantCamps = await participantCollection.find({ participantEmail: email }).toArray();

        if (participantCamps.length > 0) {
            res.status(200).send(participantCamps);
        } else {
            res.status(404).send({ success: false, message: "No registered camps found." });
        }
    } catch (error) {
        console.error("Error fetching analytics data:", error);
        res.status(500).send({ success: false, message: "Internal server error." });
    }
});


  // Function ends here
}

run().catch(console.dir);
