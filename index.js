const express = require("express");
const cors = require("cors");
require("dotenv").config();
const jwt = require("jsonwebtoken");
const cookieParser = require("cookie-parser");
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const app = express();
const port = process.env.PORT || 5000;

// middleware
app.use(
  cors({
    origin: ["http://localhost:5173", "https://medicamp-76a03.web.app"],
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
  if (!req.headers.authorization) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  const token = req.headers.authorization.split(" ")[1];
  jwt.verify(token, process.env.ACCESS_TOKEN, (err, decoded) => {
    if (err) {
      console.log(err);
      return res.status(401).send({ message: "unauthorized access" });
    }
    req.decoded = decoded;
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
      .send({ success: true, token });
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
  // use verify admin
  const verifyAdmin = async (req, res, next) => {
    const email = req.decoded.email;
    const query = { email: email };
    const user = await userCollection.findOne(query);
    const isAdmin = user?.type === "organizer";
    if (!isAdmin) {
      return res.status(403).send({ message: "forbidden access" });
    }
    next();
  };

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
  app.get("/user/:email", verifyToken, async (req, res) => {
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

  // camp statistics(Public)
  app.get("/camps-stat", async (req, res) => {
    const cursor = campCollection.find();
    const result = await cursor.toArray();
    res.send(result);
  });

  // all camps databases
  app.get("/available-camps", async (req, res) => {
    const cursor = campCollection.find();
    const result = await cursor.toArray();
    res.send(result);
  });

  // for manage camps databases (organizer dashboard)
  app.get("/camps", verifyToken, verifyAdmin, async (req, res) => {
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

  // add a camp to database (organizer)
  app.post("/camps", verifyToken, verifyAdmin, async (req, res) => {
    const campData = req.body;
    if (!campData.campName || !campData.location || !campData.dateTime) {
      return res.status(400).json({ message: "Missing required camp details" });
    }
    const result = await campCollection.insertOne(campData);
    if (result.insertedId) {
      res.status(201).json({ insertedId: result.insertedId });
    } else {
      res.status(400).json({ message: "Failed to add camp" });
    }
  });

  // Delete Camp (organizer)
  app.delete(
    "/delete-camp/:campId",
    verifyToken,
    verifyAdmin,
    async (req, res) => {
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
    }
  );

  // Update Camp (organizer)
  app.put("/update-camp/:id", verifyToken, verifyAdmin, async (req, res) => {
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
  app.post("/joinedParticipant", verifyToken, async (req, res) => {
    const registrationData = req.body;
    const result = await participantCollection.insertOne(registrationData);
    res.status(201).send({
      success: true,
      message: "Participant registered successfully",
      result,
    });
  });

  // Get participant registrations
  app.get("/participants", verifyToken, verifyAdmin, async (req, res) => {
    const cursor = participantCollection.find();
    const result = await cursor.toArray();
    res.send(result);
  });

  // Delete participant
  app.delete(
    "/cancel-registration/:id",
    verifyToken,
    async (req, res) => {
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
    }
  );

  // Update participant pending status
  app.put(
    "/confirm-registration/:id",
    verifyToken,
    verifyAdmin,
    async (req, res) => {
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
    }
  );

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
  app.get("/analytics/:email", verifyToken, async (req, res) => {
    const { email } = req.params;
    if (!email) {
      return res
        .status(400)
        .send({ success: false, message: "Email is required." });
    }

    const participantCamps = await participantCollection
      .find({ participantEmail: email })
      .toArray();

    if (participantCamps.length > 0) {
      res.status(200).send(participantCamps);
    } else {
      res
        .status(404)
        .send({ success: false, message: "No registered camps found." });
    }
  });

  // Get all camps registered by a participant
  app.get("/registered-camps/:email", verifyToken, async (req, res) => {
    const { email } = req.params;
    const result = await participantCollection
      .find({ participantEmail: email })
      .toArray();
    res.status(200).send(result);
  });

  // Cancel registration
  app.delete("/cancel-registration/:id", verifyToken, async (req, res) => {
    const { id } = req.params;

    const registration = await participantCollection.findOne({
      _id: new ObjectId(id),
    });

    if (!registration) {
      return res.status(404).send({ success: false, message: "Not found" });
    }

    if (registration.paymentStatus === "Paid") {
      return res.status(400).send({
        success: false,
        message: "Cannot cancel a paid registration",
      });
    }

    const result = await participantCollection.deleteOne({
      _id: new ObjectId(id),
    });

    if (result.deletedCount > 0) {
      res.status(200).send({ success: true, message: "Registration canceled" });
    } else {
      res.status(500).send({ success: false, message: "Cancellation failed" });
    }
  });

  // Feedback collection
  const feedbackCollection = client.db("mediCamp").collection("feedback");

  // Get feedback for home page(Public)
  app.get("/feedback", async (req, res) => {
    const feedbacks = await feedbackCollection.find().toArray();
    res.status(200).send(feedbacks);
  });

  // Submit feedback
  app.post("/submit-feedback", verifyToken, async (req, res) => {
    const {
      campId,
      campName,
      email: participantEmail,
      rating,
      feedback,
      userName,
      photoURL,
    } = req.body;

    if (!campId || !participantEmail || !feedback || !rating) {
      return res
        .status(400)
        .send({ success: false, message: "All fields are required." });
    }

    const feedbackData = {
      campId,
      campName,
      participantEmail,
      rating,
      feedback,
      userName,
      photoURL,
      date: new Date(),
    };

    try {
      const result = await feedbackCollection.insertOne(feedbackData);

      if (result.acknowledged) {
        res
          .status(200)
          .send({ success: true, message: "Feedback submitted successfully" });
      } else {
        res
          .status(500)
          .send({ success: false, message: "Feedback submission failed" });
      }
    } catch (error) {
      console.error("Error submitting feedback:", error);
      res.status(500).send({
        success: false,
        message: "Server error. Please try again later.",
      });
    }
  });

  // Payment request
  const paymentCollection = client.db("mediCamp").collection("payments");
  app.get("/payment/:id", verifyToken, async (req, res) => {
    const { id } = req.params;
    const result = await participantCollection.findOne({
      _id: new ObjectId(id),
    });
    if (result) {
      res.status(200).send(result);
    } else {
      res
        .status(404)
        .send({ success: false, message: "Participant not found" });
    }
  });

  // Stripe Payment Intent
  app.post("/create-payment-intent", verifyToken, async (req, res) => {
    const { amount } = req.body;

    if (!amount || isNaN(amount)) {
      return res
        .status(400)
        .send({ success: false, message: "Invalid amount" });
    }

    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Amount in cents
      currency: "usd",
      payment_method_types: ["card"],
    });

    res.send({
      success: true,
      clientSecret: paymentIntent.client_secret,
    });
  });

  // Handle payment and store payment history
  app.post("/make-payment", verifyToken, async (req, res) => {
    const { email, campId, campName, amount, transactionId } = req.body;

    if (!email || !campId || !amount || !transactionId) {
      return res
        .status(400)
        .send({ success: false, message: "Missing required fields" });
    }

    const paymentRecord = {
      participantEmail: email,
      joinedCampId: new ObjectId(campId),
      campName,
      amount,
      transactionId,
      date: new Date(),
    };

    const paymentResult = await paymentCollection.insertOne(paymentRecord);

    if (paymentResult.insertedId) {
      res.status(201).send({ success: true, message: "Payment successful" });
    } else {
      res.status(500).send({ success: false, message: "Payment failed" });
    }
  });

  // Update payment status (participant)
  app.put("/update-payment-status/:id", verifyToken, async (req, res) => {
    const { id } = req.params;
    const { paymentStatus } = req.body;

    const result = await participantCollection.updateOne(
      { _id: new ObjectId(id) },
      { $set: { paymentStatus } }
    );

    if (result.modifiedCount === 1) {
      res.status(200).send({ success: true, message: "Status updated" });
    } else {
      res
        .status(404)
        .send({ success: false, message: "Registration not found" });
    }
  });

  // Update confirmation status (organizer)
  app.put("/update-confirmation/:id", async (req, res) => {
    const { id } = req.params;

    try {
      const result = await participantCollection.updateOne(
        { _id: new ObjectId(id) },
        { $set: { confirmationStatus: "Confirmed" } }
      );

      if (result.modifiedCount === 1) {
        res.status(200).send({ success: true, message: "Status updated" });
      } else {
        res
          .status(404)
          .send({ success: false, message: "Registration not found" });
      }
    } catch (error) {
      console.error(error);
      res
        .status(500)
        .send({ success: false, message: "Internal Server Error" });
    }
  });

  // Fetch payment history by participant email
  app.get("/payment-history/:email", verifyToken, async (req, res) => {
    const { email } = req.params;
    const payments = await paymentCollection
      .find({ participantEmail: email })
      .toArray();

    if (payments.length > 0) {
      res.status(200).send({ success: true, data: payments });
    } else {
      res.status(404).send({ success: false, message: "No payments found" });
    }
  });

  // Upcoming Events
  app.get("/upcoming-events", async (req, res) => {
    const lastCamps = await campCollection
      .find()
      .sort({ _id: -1 })
      .limit(3)
      .toArray();

    res.status(200).send(lastCamps);
  });

  // Get feedback by participant email
  app.get("/feedback/:email", verifyToken, async (req, res) => {
    const { email } = req.params;
    const feedbacks = await feedbackCollection
      .find({ participantEmail: email })
      .toArray();

    res.status(200).send(feedbacks);
  });

  // Delete feedbacks
  app.delete("/feedback/:id", verifyToken, async (req, res) => {
    const { id } = req.params;
    const result = await feedbackCollection.deleteOne({
      _id: new ObjectId(id),
    });
    if (result.deletedCount === 1) {
      res.status(200).send({ success: true, message: "Feedback deleted" });
    } else {
      res.status(404).send({
        success: false,
        message: "Feedback not found or already deleted",
      });
    }
  });

  // Function ends here *****************************************************************************
}

run().catch(console.dir);
