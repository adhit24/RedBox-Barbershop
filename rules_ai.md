# AI Hairstyle Analysis — Cost Optimization & Protection Rules

## Overview

This document contains essential rules and optimization strategies for building a cost-efficient AI Hairstyle Analysis feature using OpenAI GPT-4o-mini Vision API.

Goal:

* Minimize API cost
* Prevent abuse/spam
* Improve performance
* Keep MVP sustainable with low budget

---

# 1. OpenAI Usage Limit

## Required

Always set API spending limits inside OpenAI dashboard.

OpenAI Dashboard:
https://platform.openai.com/settings/organization/limits

## Recommended Setup

* Soft Limit: $7
* Hard Limit: $10

Purpose:

* Prevent accidental overspending
* Stop API automatically when limit reached

---

# 2. Image Compression Rules

## Never Upload Original Camera Files

Avoid:

* 4K images
* Large iPhone photos
* PNG uploads above 2MB

Reason:
Large images increase Vision API cost and response time.

---

## Recommended Upload Settings

| Setting   | Recommended Value |
| --------- | ----------------- |
| Max Width | 768px             |
| Max Size  | 0.4MB             |
| Quality   | 70–80%            |
| Format    | WEBP / JPEG       |

---

## Frontend Compression

Install:

```bash
npm install browser-image-compression
```

Example:

```javascript
import imageCompression from 'browser-image-compression';

const compressedFile = await imageCompression(file, {
  maxSizeMB: 0.4,
  maxWidthOrHeight: 768,
  useWebWorker: true,
});
```

Benefits:

* Faster upload
* Lower API cost
* Better mobile experience

---

# 3. Anti Spam Generate Protection

## Generate Limit Per User

Recommended:

* Max 3 generates per session

Example:

```javascript
const MAX_GENERATE = 3;
```

Store count using:

* localStorage
* cookies
* database
* user account

---

## Example Limit Logic

```javascript
const currentUsage = localStorage.getItem("generate_count") || 0;

if (currentUsage >= 3) {
  alert("Generation limit reached");
  return;
}

localStorage.setItem(
  "generate_count",
  Number(currentUsage) + 1
);
```

---

# 4. Cooldown Timer

Add cooldown after each generation.

Recommended:

* 20–30 seconds cooldown

Example:

```javascript
button.disabled = true;

setTimeout(() => {
  button.disabled = false;
}, 30000);
```

Purpose:

* Prevent spam clicking
* Reduce unnecessary API calls
* Lower server load

---

# 5. Avoid HD Output

For MVP:

* Use medium resolution only

Recommended:

* 512px–768px output

Avoid:

* 2K
* 4K
* Ultra HD render

Reason:
Users only need preview quality during analysis.

---

# 6. Use Preset Hairstyle Database

DO NOT generate every hairstyle using AI.

Recommended:

* Prepare hairstyle preset images manually
* AI only analyzes and recommends

Example:

```json
{
  "oval": {
    "recommended": [
      "Two Block",
      "Comma Hair",
      "Textured Crop"
    ]
  }
}
```

Benefits:

* Massive cost reduction
* Faster response
* More consistent visual quality

---

# 7. Use Structured JSON Output

Always request JSON response from GPT.

Recommended:

```json
{
  "face_shape": "Oval",
  "hair_type": "Straight",
  "recommended_hairstyles": [
    "Two Block",
    "Classic Taper"
  ]
}
```

Avoid:

* Long paragraphs
* Essay explanations
* Unnecessary text

Reason:
Tokens = cost

Short structured responses are cheaper and easier to render.

---

# 8. Cache Previous Results

If same image uploaded again:

* Reuse previous analysis result
* Avoid repeated API calls

Suggested:

* Store image hash
* Save JSON result

Benefits:

* Lower cost
* Faster loading
* Better scalability

---

# 9. Recommended MVP Architecture

## AI Tasks

Use GPT-4o-mini Vision for:

* Face analysis
* Hair analysis
* Recommendation logic

## Non-AI Tasks

Use local assets/database for:

* Hairstyle previews
* Product images
* UI infographic layout

---

# 10. Recommended MVP Philosophy

Focus on:

* Fast
* Cheap
* Visually premium
* Social-share friendly

Avoid:

* Real-time AI video
* Full face generation
* Unlimited regenerate
* Heavy GPU infrastructure

Goal:
Make the AI feel premium while keeping backend cost extremely low.
