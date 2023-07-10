import { SendEmailRequest } from "customerio-node";
import { removeOldestFromQueue } from "./queue";

interface EmailOptions {
  email: string;
  video: {
    title: string;
    link: string;
  };
}

export const CIO_HOST = "https://api.customer.io/";

const MAGICAL_HELLO_EMAIL = {
  email: "videotranslation@getmagical.com",
  name: "Magical - Video Translation"
};

const CIO_DEFAULT_FROM_EMAIL = `"${MAGICAL_HELLO_EMAIL.name}" <${MAGICAL_HELLO_EMAIL.email}>`;

export async function sendEmail(api, options: EmailOptions): Promise<void> {
  const request = new SendEmailRequest({
    to: options.email,
    from: CIO_DEFAULT_FROM_EMAIL,
    subject: "Your translated video has been uploaded!",
    body: `<strong>Your translated video has been uploaded to YouTube!</strong><br><br>
    
    Title: ${options.video.title}<br>
    
    You can view it here: ${options.video.link}`,
    identifiers: {
      email: options.email
    }
  });

  api
    .sendEmail(request)
    .then((res) => console.log("Successfully sent email to " + options.email))
    .catch((err) => {
      console.log(err, err.statusCode, err.message);
      removeOldestFromQueue();
    });
}
