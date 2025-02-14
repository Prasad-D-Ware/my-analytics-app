import { NextResponse } from "next/server";

// Define callback types if you're using streaming features
type OnUpdate = (data: unknown) => void;
type OnClose = (message: string) => void;
type OnError = (error: Error) => void;

interface LangflowResponse {
  outputs?: Array<{
    outputs: Array<{
      artifacts?: {
        stream_url?: string;
      };
      outputs?: {
        message?: {
          message?: {
            text?: string;
          };
        };
      };
    }>;
  }>;
}

class LangflowClient {
  private baseURL: string;
  private applicationToken: string;

  constructor(baseURL: string, applicationToken: string) {
    this.baseURL = baseURL;
    this.applicationToken = applicationToken;
  }

  /**
   * Generic POST utility method
   * @param endpoint - The endpoint (relative to baseURL)
   * @param body - The body payload
   * @param headers - Additional headers (default to JSON)
   */
  async post(
    endpoint: string,
    body: Record<string, unknown>,
    headers: Record<string, string> = { "Content-Type": "application/json" }
  ): Promise<LangflowResponse> {
    headers["Authorization"] = `Bearer ${this.applicationToken}`;
    headers["Content-Type"] = "application/json";
    const url = `${this.baseURL}${endpoint}`;

    try {
      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      const responseMessage = await response.json();
      if (!response.ok) {
        throw new Error(
          `${response.status} ${response.statusText} - ${JSON.stringify(
            responseMessage
          )}`
        );
      }
      return responseMessage;
    } catch (error) {
      console.error("Request Error:", error instanceof Error ? error.message : String(error));
      throw error;
    }
  }

  /**
   * Initiates a session with Langflow
   */
  async initiateSession(
    flowId: string,
    langflowId: string,
    inputValue: string,
    inputType: string = "chat",
    outputType: string = "chat",
    stream: boolean = false,
    tweaks: Record<string, unknown> = {}
  ): Promise<LangflowResponse> {
    const endpoint = `/lf/${langflowId}/api/v1/run/${flowId}?stream=${stream}`;
    return this.post(endpoint, {
      input_value: inputValue,
      input_type: inputType,
      output_type: outputType,
      tweaks: tweaks,
    });
  }

  /**
   * Handles SSE streaming from a provided URL
   */
  handleStream(
    streamUrl: string,
    onUpdate: OnUpdate,
    onClose: OnClose,
    onError: OnError
  ): EventSource {
    const eventSource = new EventSource(streamUrl);

    eventSource.onmessage = (event: MessageEvent) => {
      const data = JSON.parse(event.data);
      onUpdate(data);
    };

    eventSource.onerror = (event: Event) => {
      console.error("Stream Error:", event);
      onError(new Error("Stream error occurred"));
      eventSource.close();
    };

    eventSource.addEventListener("close", () => {
      onClose("Stream closed");
      eventSource.close();
    });

    return eventSource;
  }

  /**
   * Runs a flow, optionally with streaming
   */
  async runFlow(
    flowIdOrName: string,
    langflowId: string,
    inputValue: string,
    inputType: string = "chat",
    outputType: string = "chat",
    tweaks: Record<string, unknown> = {},
    stream: boolean = false,
    onUpdate?: OnUpdate,
    onClose?: OnClose,
    onError?: OnError
  ): Promise<LangflowResponse> {
    try {
      const initResponse = await this.initiateSession(
        flowIdOrName,
        langflowId,
        inputValue,
        inputType,
        outputType,
        stream,
        tweaks
      );
      console.log("Init Response:", initResponse);

      if (
        stream &&
        initResponse?.outputs &&
        initResponse.outputs[0]?.outputs[0]?.artifacts?.stream_url
      ) {
        const streamUrl = initResponse.outputs[0].outputs[0].artifacts.stream_url;
        console.log(`Streaming from: ${streamUrl}`);

        if (onUpdate && onClose && onError) {
          this.handleStream(streamUrl, onUpdate, onClose, onError);
        }
      }

      console.log(initResponse)

      return initResponse;
    } catch (error) {
      console.error("Error running flow:", error);
      if (onError) {
        onError(error instanceof Error ? error : new Error("Unknown error"));
      }
      throw error;
    }
  }
}

/**
 * Main POST handler for /api/... route
 * This function is called when your Next.js app receives a POST request
 */
export async function POST(request: Request) {
  try {
    const { flowId, langflowId, inputValue, inputType, outputType, tweaks } =
      await request.json();

    const langflowClient = new LangflowClient(
      process.env.NEXT_PUBLIC_BASE_URL!,
      process.env.LANGFLOW_APPLICATION_TOKEN!
    );

    const result = await langflowClient.runFlow(
      flowId,
      langflowId,
      inputValue,
      inputType,
      outputType,
      tweaks,
      false // Set to true if you'd like to enable SSE streaming
      // onUpdate, onClose, onError => if you implement streaming
    );

    return NextResponse.json({ success: true, data: result });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}
