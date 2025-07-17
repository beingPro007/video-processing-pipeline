import { configDotenv } from "dotenv";
import app from "./app.js";

configDotenv({
    path: ".env"
})

app.on("error", (err) => {
    console.error("Error in server setup", err instanceof Error ? err.message : err);
})

app.listen(process.env.PORT ?? 8000, () => {
    console.log("Server is running on: ", process.env.PORT ?? 8000);
})