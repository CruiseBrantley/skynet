const axios = require('axios');

/**
 * Generates an image using raw ComfyUI API on localhost:7821 (GGUF Q8_0)
 * @param {string} prompt - The image prompt.
 * @param {object} options - Options: { width, height, steps, cfg }
 * @returns {Promise<Buffer>} - Respective image buffer.
 */
async function generateWithComfyDirect(prompt, options = {}) {
    const width = options.width || 1024;
    const height = options.height || 1024;
    const steps = options.steps || 8;
    const cfg = options.cfg || 1.0;

    const comfyGraph = {
        "3": { 
            "inputs": { 
                "seed": Math.floor(Math.random() * 1000000000000000), 
                "steps": steps, 
                "cfg": cfg, 
                "sampler_name": "euler", 
                "scheduler": "simple", 
                "denoise": 1, 
                "model": ["11", 0], 
                "positive": ["6", 0], 
                "negative": ["7", 0], 
                "latent_image": ["5", 0] 
            }, 
            "class_type": "KSampler" 
        },
        "4": { "inputs": { "vae_name": "ae.safetensors" }, "class_type": "VAELoader" },
        "5": { "inputs": { "width": width, "height": height, "batch_size": 1 }, "class_type": "EmptySD3LatentImage" },
        "6": { "inputs": { "text": prompt, "clip": ["9", 0] }, "class_type": "CLIPTextEncode" },
        "7": { "inputs": { "text": "blurry ugly bad", "clip": ["9", 0] }, "class_type": "CLIPTextEncode" },
        "8": { "inputs": { "samples": ["3", 0], "vae": ["4", 0] }, "class_type": "VAEDecode" },
        "9": { "inputs": { "clip_name": "qwen_3_4b.safetensors", "type": "lumina2" }, "class_type": "CLIPLoader" },
        "10": { "inputs": { "unet_name": "z-image-turbo-Q8_0.gguf" }, "class_type": "UnetLoaderGGUF" },
        "11": { "inputs": { "model": ["10", 0], "shift": 3 }, "class_type": "ModelSamplingAuraFlow" },
        "12": { "inputs": { "images": ["8", 0], "filename_prefix": "ComfyUI" }, "class_type": "SaveImage" }
    };

    const promptRes = await axios.post('http://127.0.0.1:7821/prompt', { prompt: comfyGraph });
    const promptId = promptRes.data.prompt_id;
    if (!promptId) throw new Error("No prompt ID returned from ComfyUI Direct API.");

    let finished = false;
    let images = [];
    while (!finished) {
        const check = await axios.get(`http://127.0.0.1:7821/history/${promptId}`);
        if (check.data && check.data[promptId] && check.data[promptId].outputs) {
            images = check.data[promptId].outputs["12"] ? check.data[promptId].outputs["12"].images : [];
            finished = true;
        } else {
            await new Promise(r => setTimeout(r, 2000));
        }
    }

    if (images.length === 0) throw new Error("ComfyUI Direct failed to return image output buffers.");
    const outputName = images[0].filename;
    const directUrl = `http://127.0.0.1:7821/view?filename=${outputName}`;

    const imageResponse = await axios.get(directUrl, { responseType: 'arraybuffer', timeout: 60000 });
    return Buffer.from(imageResponse.data, 'binary');
}

module.exports = { generateWithComfyDirect };
