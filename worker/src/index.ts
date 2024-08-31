import { PrismaClient } from "@prisma/client"
import { Kafka } from "kafkajs"
import { parse } from "./parser";
import { sendMail } from "./email";
import { JsonObject } from "@prisma/client/runtime/library";
import { sendSol } from "./solana";

const prismaClient = new PrismaClient();
const TOPIC_NAME = "zap-events";

const kafka = new Kafka({
    clientId: "outbox-processor-2",
    brokers: ["localhost:9092"]
})

async function main() {
    const consumer = kafka.consumer({
        groupId: "main-worker-2"
    })

    await consumer.connect()

    const producer = kafka.producer()
    await producer.connect()

    await consumer.subscribe({
        topic: TOPIC_NAME,
        fromBeginning: true
    })

    await consumer.run({
        autoCommit: false,
        eachMessage: async ({ topic, partition, message }) => {
            if (!message.value?.toString()) {
                return;
            }
            const parsedValue = JSON.parse(message.value?.toString());
            const zaprunId = parsedValue.zapRunId;
            const stage = parsedValue.stage;

            const zapRunDetails = await prismaClient.zapRun.findFirst({
                where: {
                    id: zaprunId
                },
                include: {
                    zap: {
                        include: {
                            actions: {
                                include: {
                                    type: true
                                }
                            }
                        }
                    }
                }
            })

            const currentAction = zapRunDetails?.zap.actions.find(x => x.sortingOrder === stage);
            if (!currentAction) {
                return;
            }
            const zapRunMetadata = zapRunDetails?.metadata;

            if (currentAction.type.id === "email") {
                const body = parse((currentAction.metadata as JsonObject)?.body as string, zapRunMetadata);
                const to = parse((currentAction.metadata as JsonObject)?.email as string, zapRunMetadata);
                console.log(`Sending out email to ${to} body is ${body}`)
                await sendMail(to, body, "You receive solana from zapier");
            }
            if (currentAction.type.id == "send-sol") {
                const amount = parse((currentAction.metadata as JsonObject)?.amount as string, zapRunMetadata)
                const address = parse((currentAction.metadata as JsonObject)?.address as string, zapRunMetadata)
                await sendSol(address, amount)
            }

            await new Promise(r => setTimeout(r, 500));

            const lastStage = (zapRunDetails?.zap.actions.length || 1) - 1
            if (lastStage !== stage) {
                await producer.send({
                    topic: TOPIC_NAME,
                    messages: [{
                        value: JSON.stringify({
                            stage: stage + 1,
                            zaprunId
                        })
                    }]
                })

                await consumer.commitOffsets([{
                    topic: TOPIC_NAME,
                    partition: partition,
                    offset: (parseInt(message.offset) + 1).toString()
                }])
            }
        }
    })
}

main()