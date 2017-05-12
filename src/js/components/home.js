import React from 'react';

export default class Body extends React.Component {
    constructor() {
        super();
        this.state = {
            counter: 0,
        };
    }
    
    render() {
        return (
<div class="container">
    <div class="jumbotron">
        <h1>Welcome to the Table!</h1>
        <p>Play the Game you want.</p>
        <p><a class="btn btn-primary btn-lg">Learn more</a></p>
    </div>
</div>
        );
    }
}
