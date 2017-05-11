import React from 'react'; 
import Logo from '../../images/table.png';

export default class Header extends React.Component { 
    render() { 
        return (
<header>
    <div class="container">
        <nav class="navbar navbar-default">
            <div class="container-fluid">
                <div class="navbar-header">
                    <button type="button" class="navbar-toggle collapsed" data-toggle="collapse" data-target="#bs-example-navbar-collapse-1">
        <span class="sr-only">Toggle navigation</span>
        <span class="icon-bar"></span>
        <span class="icon-bar"></span>
        <span class="icon-bar"></span>
      </button>
                    <a class="navbar-brand" href="/">
                        <img id="logo" src="../../../images/table.png" width="45px" alt="Table Icon"></img>
                    </a>
                </div>

                <div class="collapse navbar-collapse" id="bs-example-navbar-collapse-1">
                    <ul class="nav navbar-nav">
                        <li class="active"><a href="/">Home <span class="sr-only">(current)</span></a></li>
                        <li><a href="/archives">Archives</a></li>
                        <li><a href="/settings">Settings</a></li>
                    </ul>
                </div>
            </div>
        </nav>
    </div>
</header>
); 
} 
}