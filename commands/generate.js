const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const axios = require('axios');
const logger = require('../logger');
const { queryOllama } = require('../util/ollama');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('imagine')
        .setDescription('Generate an image using Skynet (Remote SwarmUI RTX 5090)')
        .addStringOption(option =>
            option.setName('prompt')
                .setDescription('Visual description of the image to generate')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('aspect_ratio')
                .setDescription('Aspect Ratio (default: Square)')
                .setRequired(false)
                .addChoices(
                    { name: 'Square (1024x1024)', value: 'square' },
                    { name: 'Portrait (1024x1536)', value: 'portrait' },
                    { name: 'Landscape (1536x1024)', value: 'landscape' }
                ))
        .addAttachmentOption(option =>
            option.setName('image')
                .setDescription('Optional image to use as an initial reference (Img2Img)')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('use_last_image')
                .setDescription('Automatically grab the last image posted in the channel as a reference')
                .setRequired(false))
        .addBooleanOption(option =>
            option.setName('enhance_prompt')
                .setDescription('Use Skynet AI to rewrite and enhance your prompt with rich visual details before generating')
                .setRequired(false))
        .addStringOption(option =>
            option.setName('creativity')
                .setDescription('How much the AI can reimagine the reference image (default: Medium)')
                .setRequired(false)
                .addChoices(
                    { name: 'Low (0.3)', value: '0.3' },
                    { name: 'Medium (0.6)', value: '0.6' },
                    { name: 'High (0.85)', value: '0.85' },
                    { name: 'Very High (1.0)', value: '1.0' }
                ))
        .addStringOption(option =>
            option.setName('model')
                .setDescription('Model to use (default: Turbo)')
                .setRequired(false)
                .addChoices(
                    { name: 'Turbo (Fast / 8 Steps)', value: 'turbo' },
                    { name: 'Flux Dev (Quality / 30 Steps)', value: 'flux' }
                ))
        .addIntegerOption(option =>
            option.setName('steps')
                .setDescription('Number of inference steps (default: 8, Flux Dev specs: 50)')
                .setRequired(false)),
    async execute(interaction) {
        await interaction.deferReply();
        let typingInterval;
        const stopTyping = () => { if (typingInterval) clearInterval(typingInterval); };

        try {
            // Start typing loop immediately
            interaction.channel.sendTyping().catch(() => { });
            typingInterval = setInterval(() => { interaction.channel.sendTyping().catch(() => { }); }, 9000);

            let prompt = interaction.options.getString('prompt');
            const originalPrompt = prompt;
            const aspectRatio = interaction.options.getString('aspect_ratio') || 'square';
            const explicitImage = interaction.options.getAttachment('image');
            const useLastImage = interaction.options.getBoolean('use_last_image') || false;
            const enhancePrompt = interaction.options.getBoolean('enhance_prompt') || false;
            const creativity = parseFloat(interaction.options.getString('creativity') || '0.6');
            const modelKey = interaction.options.getString('model') || 'turbo';
            
            let customModel = 'ZImage/SwarmUI_Z-Image-Turbo-FP8Mix.safetensors';
            let defaultSteps = 8;
            let defaultCfg = 1.0;

            if (modelKey === 'flux') {
                customModel = 'flux2-dev-Q6_K.gguf';
                defaultSteps = 30;
                defaultCfg = 1.0;
            }

            const steps = interaction.options.getInteger('steps') || defaultSteps;

            if (enhancePrompt) {
                try {
                    const ollamaRes = await queryOllama('/api/generate', {
                        prompt: `You are an expert AI image generation prompt writer. The user wants an image of: "${prompt}". Write a highly detailed, descriptive, comma-separated list of visual keywords, lighting, and photographic styles to create the best possible image prompt. Do not include any introductory or conversational text, just the raw image prompt.`,
                        options: { num_predict: 120 }
                    });
                    
                    if (ollamaRes && ollamaRes.response) {
                        prompt = ollamaRes.response.trim();
                        logger.info(`Enhanced prompt from "${originalPrompt}" to "${prompt}"`);
                    }
                } catch (err) {
                    logger.error(`Failed to enhance prompt: ${err.message}`);
                }
            }

            let width = 1024;
            let height = 1024;
            if (aspectRatio === 'portrait') {
                width = 1024;
                height = 1536;
            } else if (aspectRatio === 'landscape') {
                width = 1536;
                height = 1024;
            }

            // Figure out base64 init image if provided
            let base64InitImage = null;
            let targetAttachmentUrl = null;

            if (explicitImage && explicitImage.contentType && explicitImage.contentType.startsWith('image/')) {
                targetAttachmentUrl = explicitImage.url;
            } else if (useLastImage) {
                // Fetch last 15 messages to find an image
                const messages = await interaction.channel.messages.fetch({ limit: 15 });
                const msgWithImage = messages.find(m => m.attachments.size > 0 && m.attachments.first().contentType && m.attachments.first().contentType.startsWith('image/'));
                if (msgWithImage) {
                    targetAttachmentUrl = msgWithImage.attachments.first().url;
                }
            }

            if (targetAttachmentUrl) {
                try {
                    const imgRes = await axios.get(targetAttachmentUrl, { responseType: 'arraybuffer' });
                    base64InitImage = 'data:image/png;base64,' + Buffer.from(imgRes.data, 'binary').toString('base64');
                } catch (err) {
                    logger.error(`Failed to download init image: ${err.message}`);
                }
            }

            // 1. Get Session ID
            let baseUrl = 'http://192.168.50.182:7801';
            let sessionRes;
            let useComfyDirect = false;
            
            try {
                sessionRes = await axios.post(`${baseUrl}/API/GetNewSession`, {}, { timeout: 10000 });
            } catch (err) {
                logger.info(`Remote SwarmUI Core offline at ${baseUrl}. Re-routing to local Mac Mini fallback.`);
                baseUrl = 'http://127.0.0.1:7801';
                
                if (customModel === 'ZImage/SwarmUI_Z-Image-Turbo-FP8Mix.safetensors' || customModel === 'z-image-turbo-Q8_0.gguf') {
                    useComfyDirect = true;
                }
                
                try {
                    if (!useComfyDirect) {
                        sessionRes = await axios.post(`${baseUrl}/API/GetNewSession`, {}, { timeout: 5000 });
                    }
                } catch (localErr) {
                    throw new Error("Skynet Image Core offline. Both remote PC and local Mac Mini are unreachable.");
                }
            }

            let buffer;
            let successMessagePrefix = '';

            if (useComfyDirect) {
                logger.info(`Using direct ComfyUI API on Mac Mini for GGUF execution.`);
                const { generateWithComfyDirect } = require('../util/comfy');
                buffer = await generateWithComfyDirect(prompt, { width, height, steps, cfg: defaultCfg });
                successMessagePrefix = '✅ Local Fallback Image Generated\n';
            } else {
                const sessionId = sessionRes.data.session_id;

                // 2. Generate Image
                const generatePayload = {
                    session_id: sessionId,
                    prompt: prompt,
                    model: customModel,
                    images: 1,
                    width: width,
                    height: height,
                    cfg_scale: defaultCfg,
                    steps: steps
                };

                if (base64InitImage) {
                    generatePayload.initimage = base64InitImage;
                    generatePayload.initimage_creativity = creativity; 
                }

                const genRes = await axios.post(`${baseUrl}/API/GenerateText2Image`, generatePayload, { timeout: 600000 });

                if (!genRes.data || !genRes.data.images || genRes.data.images.length === 0) {
                    const errorDetail = genRes.data && genRes.data.error ? genRes.data.error : "Image Core failed to process the generation matrices.";
                    throw new Error(errorDetail);
                }

                const imagePath = genRes.data.images[0];
                const imageUrl = `${baseUrl}/${imagePath}`;

                // 3. Download the result
                const imageResponse = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 60000 });
                buffer = Buffer.from(imageResponse.data, 'binary');
            }

            // 4. Send to Discord
            const attachment = new AttachmentBuilder(buffer, { name: 'skynet_generation.png' });

            stopTyping();

            let replyContent = `${successMessagePrefix}**Prompt:** *${originalPrompt}*`;
            if (enhancePrompt && originalPrompt !== prompt) {
                replyContent += `\n**Enhanced:** *${prompt}*`;
            }

            try {
                await interaction.editReply({
                    content: replyContent,
                    files: [attachment]
                });
            } catch (discordErr) {
                // Interaction timed out, send to channel
                await interaction.channel.send({
                    content: `<@${interaction.user.id}> ${replyContent}`,
                    files: [attachment]
                });
            }

        } catch (err) {
            stopTyping();
            logger.error(`Generation error: ${err.message}`);
            const errorMsg = err.message.includes('offline') ? err.message : 'There was an error communicating with the Skynet Image Core.';
            try {
                await interaction.editReply(errorMsg);
            } catch (discordErr) {
                await interaction.channel.send(errorMsg);
            }
        }
    },
};
