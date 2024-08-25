import express from "express"
import cors from "cors"
import { PrismaClient } from "@prisma/client";

const client = new PrismaClient()
const app = express()

app.use(express.json())
app.use(cors())

app.post('/hooks/catch/:userId/:zapId', async (req, res) => {
    const userId = req.params.userId;
    const zapId = req.params.zapId;
    const body = req.body

    await client.$transaction(async tx => {
        const run = await tx.zapRun.create({
            data: {
                zapId: zapId,
                metadata: body
            }
        })
        await tx.zapRunOutbox.create({
            data: {
                zapRunId: run.id
            }
        })
    })

    res.status(200).json({
        message: "Webhook receive"
    })
})

app.listen(8080, () => {
    console.log("App is running on 8080")
})