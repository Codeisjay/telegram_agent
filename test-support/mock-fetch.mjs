const originalFetch = globalThis.fetch
let telegramUpdateDelivered = false

globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (url.hostname === 'api.telegram.org') {
    const method = url.pathname.split('/').pop()
    if (method === 'getWebhookInfo') {
      return Response.json({ ok: true, result: { url: '' } })
    }
    if (method === 'setMyCommands') {
      return Response.json({ ok: true, result: true })
    }
    if (method === 'getUpdates') {
      if (!telegramUpdateDelivered) {
        telegramUpdateDelivered = true
        return Response.json({
          ok: true,
          result: [{
            update_id: 1,
            message: { text: '/search long telegram test', chat: { id: 123 }, from: { id: 123 } },
          }],
        })
      }
      await new Promise((resolve) => setTimeout(resolve, 10))
      return Response.json({ ok: true, result: [] })
    }
    if (method === 'sendMessage') {
      const { text, chat_id: chatId } = JSON.parse(init.body)
      if (String(chatId) === '429') {
        return Response.json({ ok: false, description: 'Telegram rate limit.' }, { status: 429 })
      }
      if (String(chatId) === '-987') throw new DOMException('The operation timed out.', 'TimeoutError')
      if (text.length > 4000) {
        return Response.json({ ok: false, description: 'Message is too long.' }, { status: 400 })
      }
      return Response.json({ ok: true, result: { message_id: 1 } })
    }
  }

  if (url.hostname === 'api.tavily.com') {
    const request = JSON.parse(init.body)
    if (url.pathname.endsWith('/search')) {
      if (request.query.trimStart().startsWith('FailCo ')) {
        return Response.json({ error: { message: 'Temporary search failure' } }, { status: 503 })
      }
      if (request.query.includes('RateLimitCo')) {
        return Response.json({ error: { message: 'Search rate limit.' } }, { status: 429 })
      }
      if (request.query.trimStart().startsWith('TimeoutCo ')) {
        throw new DOMException('The operation timed out.', 'TimeoutError')
      }
      if (request.query.includes('LlmFailCo') || request.query.includes('NotificationCo')
        || request.query.includes('LlmTimeoutCo') || request.query.includes('TelegramTimeoutCo')) {
        const jobId = request.query.includes('LlmFailCo') ? 'llm-fail-27'
          : request.query.includes('LlmTimeoutCo') ? 'llm-timeout-27'
            : request.query.includes('TelegramTimeoutCo') ? 'telegram-timeout-27'
              : request.query.includes('NotificationCo') ? 'notification-27' : 'INT-27'
        return Response.json({
          results: [{ title: 'Software Engineer Intern', url: `https://careers.example.com/jobs/${jobId}`, content: 'Official internship vacancy.' }],
        })
      }
      if (request.query.includes('ExtractFailCo')) {
        return Response.json({
          results: [{ title: 'Software Engineer Intern', url: 'https://careers.example.com/jobs/extract-fail-27', content: 'Official internship vacancy.' }],
        })
      }
      if (request.query.includes('ExtractTimeoutCo')) {
        return Response.json({
          results: [{ title: 'Software Engineer Intern', url: 'https://careers.example.com/jobs/extract-timeout-27', content: 'Official internship vacancy.' }],
        })
      }
      if (request.query.includes('SlowCo')) await new Promise((resolve) => setTimeout(resolve, 250))
      if (request.query.includes('Example Systems') || request.query.includes('NotificationCo') || request.query.includes('LlmFailCo')) {
        return Response.json({
          results: [{
            title: 'Software Engineer Intern',
            url: 'https://careers.example.com/jobs/INT-27',
            content: 'Official internship vacancy.',
          }],
        })
      }
      return Response.json({
        results: [{ title: 'Test source', url: 'https://example.test', content: 'Test search result.' }],
      })
    }
    if (url.pathname.endsWith('/extract')) {
      if (request.urls.some((pageUrl) => pageUrl.includes('extract-fail'))) {
        return Response.json({ error: { message: 'Temporary extraction failure.' } }, { status: 503 })
      }
      if (request.urls.some((pageUrl) => pageUrl.includes('extract-timeout'))) {
        throw new DOMException('The operation timed out.', 'TimeoutError')
      }
      return Response.json({
        results: request.urls.map((pageUrl) => ({
          url: pageUrl,
          raw_content: [
            'Software Engineer Intern 2027.',
            'Title: Software Engineer Intern.',
            'Job ID: INT-27.',
            'Applications are open.',
            'Graduation year 2027.',
            "Bachelor's degree in Computer Science.",
            'Minimum CGPA 7.0.',
            'No active backlogs.',
            'Experience: 0 years of experience.',
            'Employment type: Internship.',
            'Location: Bengaluru.',
            'Skills: Java and Python.',
            'Apply by December 31, 2026.',
          ].join(' '),
        })),
      })
    }
    return Response.json({
      results: [{ title: 'Test source', url: 'https://example.test', content: 'Test search result.' }],
    })
  }

  if (url.hostname === 'api.groq.com') {
    const authorization = new Headers(init?.headers).get('authorization')
    if (url.pathname.endsWith('/chat/completions')) {
      if (authorization !== 'Bearer saved-test-key') {
        return Response.json({ error: { message: 'Invalid API Key' } }, { status: 401 })
      }
      if (JSON.parse(init.body).model !== 'openai/gpt-oss-120b') {
        return Response.json({ error: { message: 'Unexpected or retired Groq model.' } }, { status: 400 })
      }
      const request = JSON.parse(init.body)
      if (request.messages.some((message) => message.content.includes('Extract only current job vacancies'))) {
        if (request.messages[0].content.includes('LlmFailCo')) {
          return Response.json({ error: { message: 'Temporary LLM failure.' } }, { status: 503 })
        }
        if (request.messages[0].content.includes('LlmTimeoutCo')) {
          throw new DOMException('The operation timed out.', 'TimeoutError')
        }
        const pageData = request.messages[0].content.match(/Fetched official career pages:\s*([\s\S]+)$/)?.[1] || '[]'
        const pages = JSON.parse(pageData)
        const content = pages[0].content
        const excerpt = (text) => content.includes(text) ? text : undefined
        const company = request.messages[0].content.match(/Company: ([^.]+)/)?.[1] || 'Example Systems'
        return Response.json({
          choices: [{
            message: {
              content: JSON.stringify([{
                company,
                title: 'Software Engineer Intern',
                sourceUrl: pages[0].url,
                jobId: 'INT-27',
                location: 'Bengaluru',
                deadline: 'December 31, 2026',
                experience: '0 years of experience',
                maxBacklogs: 0,
                backlogRequirement: 'No active backlogs',
                eligibleGraduationYears: ['2027'],
                requiredDegrees: ["Bachelor's degree"],
                requiredBranches: ['Computer Science'],
                minimumCgpa: 7,
                skills: ['Java', 'Python'],
                employmentType: 'Internship',
                salary: '',
                openStatus: 'open',
                evidence: {
                  company: excerpt(`${company}.`),
                  title: excerpt('Title: Software Engineer Intern.'),
                  openStatus: excerpt('Applications are open.'),
                  jobId: excerpt('Job ID: INT-27.'),
                  location: excerpt('Location: Bengaluru.'),
                  deadline: excerpt('Apply by December 31, 2026.'),
                  eligibleGraduationYears: excerpt('Graduation year 2027.'),
                  requiredDegrees: excerpt("Bachelor's degree in Computer Science."),
                  requiredBranches: excerpt("Bachelor's degree in Computer Science."),
                  minimumCgpa: excerpt('Minimum CGPA 7.0.'),
                  maxBacklogs: excerpt('No active backlogs.'),
                  backlogRequirement: excerpt('No active backlogs.'),
                  experience: excerpt('Experience: 0 years of experience.'),
                  employmentType: excerpt('Employment type: Internship.'),
                  skills: excerpt('Skills: Java and Python.'),
                },
              }]),
            },
          }],
        })
      }
      return Response.json({
        choices: [{
          message: {
            content: JSON.parse(init.body).messages.some((message) => message.content.includes('long telegram test'))
              ? 'x'.repeat(8100)
              : 'Mock Groq response',
          },
        }],
        usage: { total_tokens: 10 },
      })
    }
    if (url.pathname.endsWith('/models')) {
      return authorization === 'Bearer draft-test-key'
        ? Response.json({ data: [] })
        : Response.json({ error: { message: 'Invalid API Key' } }, { status: 401 })
    }
  }

  if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
    return originalFetch(input, init)
  }
  throw new Error('Unmocked external request in backend integration test.')
}
