FROM node:20-alpine

WORKDIR /app

# Install dependencies as root
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Copy app and set ownership
COPY . .
RUN chown -R node:node /app

# Create and own data directories
RUN mkdir -p /data && \
    chown -R node:node /data

# Switch to non-root user (node user already exists with UID/GID 1000)
USER node

# Set environment variables
ENV NODE_ENV=production

# Run the CLI
ENTRYPOINT ["npm", "run", "cli"]
CMD ["start"]